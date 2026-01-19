import {
  fetchVersionHistory,
  fetchFileAtVersion,
  getVersionsForComparison,
  FigmaAPIError,
} from './src/api';
import { diffFiles } from './src/diff';
import { groupChangesSemanticaly } from './src/analysis/semantic-grouper';
import { assessAllFeatures, getReadinessSummary } from './src/analysis/readiness';
import { matchFeaturesToTickets } from './src/analysis/ticket-matcher';
import {
  createStructuredDiff,
  generateStructureHTML,
  generateComponentViewHTML,
  generateStructureMarkdown,
} from './src/analysis/structure-grouper';
import type { StructuredDiff } from './src/analysis/structure-grouper';
import {
  generateStakeholderReport,
  generateStakeholderHTML,
  generateStakeholderMarkdown
} from './src/reports/stakeholder-report';
import {
  generateEngineerReport,
  generateEngineerHTML,
  generateEngineerMarkdown
} from './src/reports/engineer-report';
import { generateUIHTML, generateMarkdownReport } from './src/report';
import {
  fetchTeams,
  fetchTickets,
  validateLinearKey,
  findTicketsForFigmaFile,
  matchTicketsToFeatures,
} from './src/integrations/linear';
import {
  validateNotionToken,
  searchPages,
  createRecapPage,
  reportToNotionContent,
  extractNotionPageId,
  parseProductSpec,
} from './src/integrations/notion';
import {
  formatSlackMessage,
  postToSlack,
  validateSlackWebhook,
  generateSlackText,
} from './src/integrations/slack';
import type { DiffResult, DesignSystemIndex, ProductSpec, ScreenSpec } from './src/types';
import { indexDesignSystem } from './src/design-system/indexer';
import { generateDesignSchema, validateAnthropicKey, validateSchema, mapComponentNamesToKeys } from './src/ai/claude';
import { generateFromSchema, generateTestFrame } from './src/generator/figma-generator';

/**
 * Parse raw text input into a ProductSpec
 * Supports markdown-like formatting with # for headings and - for bullet points
 */
function parseTextSpec(text: string): ProductSpec {
  const lines = text.split('\n');
  const spec: ProductSpec = {
    title: 'Design Spec',
    overview: '',
    screens: [],
    requirements: [],
    userStories: [],
  };

  let currentScreen: ScreenSpec | null = null;
  let currentSection: 'overview' | 'elements' | 'requirements' | 'stories' = 'overview';
  const overviewParts: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // H1: # Title - becomes spec title or screen name
    if (trimmed.startsWith('# ')) {
      // Save any pending screen
      if (currentScreen) {
        spec.screens.push(currentScreen);
      }

      const heading = trimmed.substring(2).trim();

      // If no title yet, use as title
      if (spec.title === 'Design Spec') {
        spec.title = heading;
      }

      // Start a new screen
      currentScreen = {
        name: heading,
        description: '',
        elements: [],
      };
      currentSection = 'overview';
      continue;
    }

    // H2: ## Section - determines what type of content follows
    if (trimmed.startsWith('## ')) {
      const sectionName = trimmed.substring(3).trim().toLowerCase();

      if (sectionName.includes('element') || sectionName.includes('component') || sectionName.includes('ui')) {
        currentSection = 'elements';
      } else if (sectionName.includes('requirement') || sectionName.includes('spec')) {
        currentSection = 'requirements';
      } else if (sectionName.includes('user stor') || sectionName.includes('use case')) {
        currentSection = 'stories';
      } else {
        currentSection = 'overview';
      }
      continue;
    }

    // H3: ### Sub-screen or sub-section
    if (trimmed.startsWith('### ')) {
      // Save previous screen and start new one
      if (currentScreen) {
        spec.screens.push(currentScreen);
      }

      currentScreen = {
        name: trimmed.substring(4).trim(),
        description: '',
        elements: [],
      };
      currentSection = 'overview';
      continue;
    }

    // Bullet point: - item
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const item = trimmed.substring(2).trim();

      if (currentSection === 'elements' && currentScreen) {
        currentScreen.elements.push(item);
      } else if (currentSection === 'requirements') {
        spec.requirements.push(item);
      } else if (currentSection === 'stories') {
        spec.userStories.push(item);
      } else if (currentScreen) {
        // Default to elements if we have a screen
        currentScreen.elements.push(item);
      }
      continue;
    }

    // Regular text - description or overview
    if (currentScreen && !currentScreen.description) {
      currentScreen.description = trimmed;
    } else if (!currentScreen) {
      overviewParts.push(trimmed);
    }
  }

  // Save any pending screen
  if (currentScreen) {
    spec.screens.push(currentScreen);
  }

  // Compile overview
  spec.overview = overviewParts.join('\n');

  // If no screens were created but we have content, create a default screen
  if (spec.screens.length === 0 && (spec.overview || spec.requirements.length > 0)) {
    spec.screens.push({
      name: spec.title,
      description: spec.overview,
      elements: spec.requirements,
    });
  }

  return spec;
}

const STORAGE_KEY_FIGMA_TOKEN = 'recapme_figma_token';
const STORAGE_KEY_LINEAR_TOKEN = 'recapme_linear_token';
const STORAGE_KEY_NOTION_TOKEN = 'recapme_notion_token';
const STORAGE_KEY_SLACK_WEBHOOK = 'recapme_slack_webhook';
const STORAGE_KEY_LINEAR_TEAM = 'recapme_linear_team';
const STORAGE_KEY_ANTHROPIC_KEY = 'recapme_anthropic_key';
const STORAGE_KEY_DESIGN_SYSTEM_FILE = 'recapme_design_system_file';
const STORAGE_KEY_DESIGN_SYSTEM_INDEX = 'recapme_design_system_index';

// Show the plugin UI
figma.showUI(__html__, {
  width: 520,
  height: 700,
  themeColors: true,
});

// Initialize the plugin
async function initialize() {
  const fileKey = figma.fileKey;
  const [figmaToken, linearToken, notionToken, slackWebhook, linearTeam, anthropicKey, designSystemFile] = await Promise.all([
    figma.clientStorage.getAsync(STORAGE_KEY_FIGMA_TOKEN),
    figma.clientStorage.getAsync(STORAGE_KEY_LINEAR_TOKEN),
    figma.clientStorage.getAsync(STORAGE_KEY_NOTION_TOKEN),
    figma.clientStorage.getAsync(STORAGE_KEY_SLACK_WEBHOOK),
    figma.clientStorage.getAsync(STORAGE_KEY_LINEAR_TEAM),
    figma.clientStorage.getAsync(STORAGE_KEY_ANTHROPIC_KEY),
    figma.clientStorage.getAsync(STORAGE_KEY_DESIGN_SYSTEM_FILE),
  ]);

  figma.ui.postMessage({
    type: 'init',
    fileKey: fileKey || null,
    hasFigmaToken: !!figmaToken,
    hasLinearToken: !!linearToken,
    hasNotionToken: !!notionToken,
    hasSlackWebhook: !!slackWebhook,
    hasAnthropicKey: !!anthropicKey,
    linearTeam: linearTeam || null,
    figmaToken: figmaToken || null,
    linearToken: linearToken || null,
    designSystemFile: designSystemFile || null,
  });
}

// Handle messages from the UI
figma.ui.onmessage = async (msg: { type: string; [key: string]: unknown }) => {
  switch (msg.type) {
    case 'save-figma-token': {
      const token = msg.token as string;
      await figma.clientStorage.setAsync(STORAGE_KEY_FIGMA_TOKEN, token);
      figma.ui.postMessage({ type: 'figma-token-saved' });
      break;
    }

    case 'save-linear-token': {
      const token = msg.token as string;
      const isValid = await validateLinearKey(token);
      if (isValid) {
        await figma.clientStorage.setAsync(STORAGE_KEY_LINEAR_TOKEN, token);
        // Fetch teams
        try {
          const teams = await fetchTeams(token);
          figma.ui.postMessage({ type: 'linear-token-saved', teams });
        } catch {
          figma.ui.postMessage({ type: 'linear-token-saved', teams: [] });
        }
      } else {
        figma.ui.postMessage({ type: 'error', message: 'Invalid Linear API key' });
      }
      break;
    }

    case 'save-notion-token': {
      const token = msg.token as string;
      const isValid = await validateNotionToken(token);
      if (isValid) {
        await figma.clientStorage.setAsync(STORAGE_KEY_NOTION_TOKEN, token);
        figma.ui.postMessage({ type: 'notion-token-saved' });
      } else {
        figma.ui.postMessage({ type: 'error', message: 'Invalid Notion integration token' });
      }
      break;
    }

    case 'save-linear-team': {
      const teamId = msg.teamId as string;
      await figma.clientStorage.setAsync(STORAGE_KEY_LINEAR_TEAM, teamId);
      figma.ui.postMessage({ type: 'linear-team-saved' });
      break;
    }

    case 'clear-tokens': {
      await Promise.all([
        figma.clientStorage.deleteAsync(STORAGE_KEY_FIGMA_TOKEN),
        figma.clientStorage.deleteAsync(STORAGE_KEY_LINEAR_TOKEN),
        figma.clientStorage.deleteAsync(STORAGE_KEY_NOTION_TOKEN),
        figma.clientStorage.deleteAsync(STORAGE_KEY_SLACK_WEBHOOK),
        figma.clientStorage.deleteAsync(STORAGE_KEY_LINEAR_TEAM),
      ]);
      figma.ui.postMessage({ type: 'tokens-cleared' });
      break;
    }

    case 'save-slack-webhook': {
      const webhook = msg.webhook as string;
      if (validateSlackWebhook(webhook)) {
        await figma.clientStorage.setAsync(STORAGE_KEY_SLACK_WEBHOOK, webhook);
        figma.ui.postMessage({ type: 'slack-webhook-saved' });
      } else {
        figma.ui.postMessage({ type: 'error', message: 'Invalid Slack webhook URL' });
      }
      break;
    }

    case 'clear-slack-webhook': {
      await figma.clientStorage.deleteAsync(STORAGE_KEY_SLACK_WEBHOOK);
      break;
    }

    case 'share-to-slack': {
      const structuredDiff = msg.structuredDiff as StructuredDiff;
      const fileName = (msg.fileName as string) || 'Figma File';
      const dateRange = (msg.dateRange as { from: string; to: string }) || { from: '', to: '' };
      const fileKey = msg.fileKey as string;

      const webhookUrl = await figma.clientStorage.getAsync(STORAGE_KEY_SLACK_WEBHOOK);
      
      if (!structuredDiff) {
        figma.ui.postMessage({ type: 'error', message: 'No recap data to share.' });
        return;
      }

      const figmaFileUrl = fileKey ? `https://www.figma.com/file/${fileKey}` : undefined;

      // If no webhook configured, just provide copy text
      if (!webhookUrl) {
        const copyText = generateSlackText(structuredDiff, fileName, dateRange, figmaFileUrl);
        figma.ui.postMessage({ 
          type: 'slack-copy-fallback', 
          text: copyText,
          message: 'No webhook configured. Copy this message to share in Slack:',
        });
        return;
      }

      try {
        const message = formatSlackMessage(structuredDiff, fileName, dateRange, figmaFileUrl);
        const result = await postToSlack(webhookUrl, message);
        
        if (result.success) {
          figma.ui.postMessage({ type: 'slack-share-success' });
        } else {
          // CORS blocked - provide copy fallback
          const copyText = generateSlackText(structuredDiff, fileName, dateRange, figmaFileUrl);
          figma.ui.postMessage({ 
            type: 'slack-copy-fallback', 
            text: copyText,
            message: 'Direct posting blocked. Copy this message to share in Slack:',
          });
        }
      } catch (error) {
        // Provide copy fallback on any error
        const copyText = generateSlackText(structuredDiff, fileName, dateRange, figmaFileUrl);
        figma.ui.postMessage({ 
          type: 'slack-copy-fallback', 
          text: copyText,
          message: 'Could not post directly. Copy this message to share in Slack:',
        });
      }
      break;
    }

    case 'fetch-linear-teams': {
      const token = await figma.clientStorage.getAsync(STORAGE_KEY_LINEAR_TOKEN);
      if (token) {
        try {
          const teams = await fetchTeams(token);
          figma.ui.postMessage({ type: 'linear-teams', teams });
        } catch (error) {
          figma.ui.postMessage({ type: 'error', message: 'Failed to fetch Linear teams' });
        }
      }
      break;
    }

    case 'generate-recap': {
      let figmaToken = msg.figmaToken as string;
      const startDate = new Date(msg.startDate as string);
      const endDate = new Date(msg.endDate as string);
      const fileKey = (msg.fileKey as string) || figma.fileKey;
      const includeLinear = msg.includeLinear as boolean;
      const linearTeamId = msg.linearTeamId as string;
      const reportTypes = msg.reportTypes as { structure: boolean; components: boolean; diff: boolean; stakeholder: boolean; engineer: boolean };

      if (!fileKey) {
        figma.ui.postMessage({
          type: 'error',
          message: 'Could not determine file key. Please enter the Figma file URL.',
        });
        return;
      }

      // Get stored token if needed
      if (figmaToken === '__STORED__') {
        figmaToken = await figma.clientStorage.getAsync(STORAGE_KEY_FIGMA_TOKEN);
      }

      if (!figmaToken) {
        figma.ui.postMessage({
          type: 'error',
          message: 'Please enter your Figma Personal Access Token.',
        });
        return;
      }

      try {
        // Step 1: Fetch version history
        figma.ui.postMessage({
          type: 'loading',
          message: 'Fetching version history...',
        });

        const versions = await fetchVersionHistory(fileKey, figmaToken);

        if (versions.length === 0) {
          figma.ui.postMessage({
            type: 'error',
            message: 'No version history found for this file.',
          });
          return;
        }

        // Step 2: Find versions for comparison
        figma.ui.postMessage({
          type: 'loading',
          message: 'Finding versions to compare...',
        });

        const [oldVersion, newVersion] = getVersionsForComparison(versions, startDate, endDate);

        if (!oldVersion || !newVersion) {
          figma.ui.postMessage({
            type: 'error',
            message: 'Could not find versions within the specified date range.',
          });
          return;
        }

        if (oldVersion.id === newVersion.id) {
          figma.ui.postMessage({
            type: 'error',
            message: 'The selected date range contains only one version. Please expand your date range.',
          });
          return;
        }

        // Step 3: Fetch file at both versions
        figma.ui.postMessage({
          type: 'loading',
          message: 'Fetching file snapshots (this may take a moment)...',
        });

        const [oldFile, newFile] = await Promise.all([
          fetchFileAtVersion(fileKey, figmaToken, oldVersion.id),
          fetchFileAtVersion(fileKey, figmaToken, newVersion.id),
        ]);

        // Step 4: Generate diff
        figma.ui.postMessage({
          type: 'loading',
          message: 'Analyzing changes...',
        });

        const diffResult = diffFiles(oldFile, newFile, oldVersion, newVersion);

        // Initialize result variables
        let structureHTML = null;
        let componentsHTML = null;
        let stakeholderHTML = null;
        let engineerHTML = null;
        let rawDiffHTML = null;
        let stakeholderReport = null;
        let engineerReport = null;
        let semanticDiff = null;
        let readinessSummary = null;
        let ticketMatches = null;
        let linkedTickets = new Map();

        // Generate structure view if requested
        let structuredDiff: StructuredDiff | null = null;
        
        if (reportTypes.structure || reportTypes.components) {
          figma.ui.postMessage({
            type: 'loading',
            message: 'Analyzing file structure...',
          });

          structuredDiff = createStructuredDiff(diffResult);
          
          if (reportTypes.structure) {
            structureHTML = generateStructureHTML(structuredDiff);
          }
          
          if (reportTypes.components) {
            componentsHTML = generateComponentViewHTML(structuredDiff);
          }
        }

        // Only do semantic analysis if stakeholder or engineer reports are needed
        const needsSemanticAnalysis = reportTypes.stakeholder || reportTypes.engineer;

        if (needsSemanticAnalysis) {
          // Step 5: Semantic grouping
          figma.ui.postMessage({
            type: 'loading',
            message: 'Grouping changes into features...',
          });

          semanticDiff = groupChangesSemanticaly(diffResult);

          // Step 6: Assess readiness
          const readinessAssessments = assessAllFeatures(semanticDiff.features, newFile);
          readinessSummary = getReadinessSummary(readinessAssessments);

          // Step 7: Linear integration (if enabled)
          if (includeLinear && linearTeamId) {
            figma.ui.postMessage({
              type: 'loading',
              message: 'Fetching Linear tickets...',
            });

            const linearToken = await figma.clientStorage.getAsync(STORAGE_KEY_LINEAR_TOKEN);
            if (linearToken) {
              try {
                const tickets = await fetchTickets(linearToken, linearTeamId, startDate, endDate);
                const relevantTickets = findTicketsForFigmaFile(tickets, fileKey);
                ticketMatches = matchFeaturesToTickets(semanticDiff, relevantTickets.length > 0 ? relevantTickets : tickets, fileKey);
                
                // Build linked tickets map
                linkedTickets = matchTicketsToFeatures(
                  tickets,
                  semanticDiff.features.map(f => f.name)
                );
              } catch (error) {
                console.error('Linear integration error:', error);
                // Continue without Linear data
              }
            }
          }

          // Step 8: Generate reports based on requested types
          figma.ui.postMessage({
            type: 'loading',
            message: 'Generating reports...',
          });

          if (reportTypes.stakeholder) {
            stakeholderReport = generateStakeholderReport(semanticDiff, linkedTickets);
            stakeholderHTML = generateStakeholderHTML(stakeholderReport);
          }

          if (reportTypes.engineer) {
            engineerReport = generateEngineerReport(semanticDiff, readinessAssessments, fileKey);
            engineerHTML = generateEngineerHTML(engineerReport);
          }
        }

        // Generate raw diff if requested
        if (reportTypes.diff) {
          rawDiffHTML = generateUIHTML(diffResult);
        }

        figma.ui.postMessage({
          type: 'recap-result',
          structureHTML,
          componentsHTML,
          stakeholderHTML,
          engineerHTML,
          rawDiffHTML,
          stakeholderReport,
          engineerReport,
          semanticDiff,
          structuredDiff,
          readinessSummary,
          ticketMatches,
          diffResult,
          fileKey,
          fileName: newFile.name,
          dateRange: {
            from: startDate.toISOString().split('T')[0],
            to: endDate.toISOString().split('T')[0],
          },
        });
      } catch (error) {
        let message = 'An unexpected error occurred.';

        if (error instanceof FigmaAPIError) {
          message = error.message;
        } else if (error instanceof Error) {
          message = error.message;
        }

        figma.ui.postMessage({
          type: 'error',
          message,
        });
      }
      break;
    }

    case 'export-markdown': {
      const reportType = msg.reportType as string;
      const diffResult = msg.diffResult as DiffResult;

      let markdown = '';
      let filename = '';

      if (reportType === 'structure' && msg.structuredDiff) {
        const structuredDiff = msg.structuredDiff as StructuredDiff;
        const fileName = (msg.fileName as string) || 'Figma File';
        const dateRange = (msg.dateRange as { from: string; to: string }) || { from: '', to: '' };
        markdown = generateStructureMarkdown(structuredDiff, fileName, dateRange);
        filename = `design-recap-${new Date().toISOString().split('T')[0]}.md`;
      } else if (reportType === 'stakeholder' && msg.stakeholderReport) {
        markdown = generateStakeholderMarkdown(msg.stakeholderReport as Parameters<typeof generateStakeholderMarkdown>[0]);
        filename = `design-recap-stakeholder-${new Date().toISOString().split('T')[0]}.md`;
      } else if (reportType === 'engineer' && msg.engineerReport) {
        markdown = generateEngineerMarkdown(msg.engineerReport as Parameters<typeof generateEngineerMarkdown>[0]);
        filename = `design-recap-engineer-${new Date().toISOString().split('T')[0]}.md`;
      } else if (reportType === 'raw' && diffResult) {
        markdown = generateMarkdownReport(diffResult);
        filename = `design-recap-raw-${new Date().toISOString().split('T')[0]}.md`;
      }

      figma.ui.postMessage({
        type: 'export-ready',
        markdown,
        filename,
      });
      break;
    }

    case 'export-to-notion': {
      const parentPageId = msg.parentPageId as string;
      const fileKey = msg.fileKey as string;

      const notionToken = await figma.clientStorage.getAsync(STORAGE_KEY_NOTION_TOKEN);
      if (!notionToken) {
        figma.ui.postMessage({
          type: 'error',
          message: 'Please configure Notion integration first.',
        });
        return;
      }

      try {
        figma.ui.postMessage({
          type: 'loading',
          message: 'Creating Notion page...',
        });

        const figmaFileUrl = fileKey ? `https://www.figma.com/file/${fileKey}` : undefined;
        const content = reportToNotionContent(
          msg.stakeholderReport as Parameters<typeof reportToNotionContent>[0],
          figmaFileUrl
        );
        const page = await createRecapPage(notionToken, parentPageId, content);

        figma.ui.postMessage({
          type: 'notion-export-complete',
          pageUrl: page.url,
        });
      } catch (error) {
        figma.ui.postMessage({
          type: 'error',
          message: error instanceof Error ? error.message : 'Failed to create Notion page',
        });
      }
      break;
    }

    case 'fetch-notion-pages': {
      const notionToken = await figma.clientStorage.getAsync(STORAGE_KEY_NOTION_TOKEN);
      if (notionToken) {
        try {
          const pages = await searchPages(notionToken);
          figma.ui.postMessage({ type: 'notion-pages', pages });
        } catch {
          figma.ui.postMessage({ type: 'error', message: 'Failed to fetch Notion pages' });
        }
      }
      break;
    }

    // ============================================
    // Design Generation Message Handlers
    // ============================================

    case 'save-anthropic-key': {
      const key = msg.key as string;
      const isValid = await validateAnthropicKey(key);
      if (isValid) {
        await figma.clientStorage.setAsync(STORAGE_KEY_ANTHROPIC_KEY, key);
        figma.ui.postMessage({ type: 'anthropic-key-saved' });
      } else {
        figma.ui.postMessage({ type: 'error', message: 'Invalid Anthropic API key' });
      }
      break;
    }

    case 'clear-anthropic-key': {
      await figma.clientStorage.deleteAsync(STORAGE_KEY_ANTHROPIC_KEY);
      figma.ui.postMessage({ type: 'anthropic-key-cleared' });
      break;
    }

    case 'save-design-system-file': {
      const fileUrl = msg.fileUrl as string;
      // Extract file key from URL
      const match = fileUrl.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/);
      const dsFileKey = match ? match[1] : fileUrl.trim();

      if (!dsFileKey) {
        figma.ui.postMessage({ type: 'error', message: 'Invalid design system file URL' });
        break;
      }

      await figma.clientStorage.setAsync(STORAGE_KEY_DESIGN_SYSTEM_FILE, dsFileKey);
      figma.ui.postMessage({ type: 'design-system-file-saved', fileKey: dsFileKey });
      break;
    }

    case 'index-design-system': {
      const dsFileKey = msg.fileKey as string || await figma.clientStorage.getAsync(STORAGE_KEY_DESIGN_SYSTEM_FILE);
      const figmaToken = await figma.clientStorage.getAsync(STORAGE_KEY_FIGMA_TOKEN);

      if (!dsFileKey) {
        figma.ui.postMessage({ type: 'error', message: 'Please configure a design system file first' });
        break;
      }

      if (!figmaToken) {
        figma.ui.postMessage({ type: 'error', message: 'Please connect Figma first' });
        break;
      }

      try {
        figma.ui.postMessage({ type: 'loading', message: 'Indexing design system...' });

        const index = await indexDesignSystem(dsFileKey, figmaToken);

        // Cache the index
        await figma.clientStorage.setAsync(STORAGE_KEY_DESIGN_SYSTEM_INDEX, JSON.stringify(index));

        figma.ui.postMessage({
          type: 'design-system-indexed',
          index,
          componentCount: index.components.length,
        });
      } catch (error) {
        figma.ui.postMessage({
          type: 'error',
          message: error instanceof Error ? error.message : 'Failed to index design system',
        });
      }
      break;
    }

    case 'generate-from-spec': {
      const notionSpecUrl = msg.notionSpecUrl as string | undefined;
      const specText = msg.specText as string | undefined;

      // Get required credentials
      const [figmaToken, notionToken, anthropicKey, cachedIndex] = await Promise.all([
        figma.clientStorage.getAsync(STORAGE_KEY_FIGMA_TOKEN),
        figma.clientStorage.getAsync(STORAGE_KEY_NOTION_TOKEN),
        figma.clientStorage.getAsync(STORAGE_KEY_ANTHROPIC_KEY),
        figma.clientStorage.getAsync(STORAGE_KEY_DESIGN_SYSTEM_INDEX),
      ]);

      if (!figmaToken) {
        figma.ui.postMessage({ type: 'error', message: 'Please connect Figma first' });
        break;
      }

      if (!anthropicKey) {
        figma.ui.postMessage({ type: 'error', message: 'Please add your Anthropic API key' });
        break;
      }

      if (!cachedIndex) {
        figma.ui.postMessage({ type: 'error', message: 'Please index a design system first' });
        break;
      }

      // Parse the cached index
      let designSystemIndex: DesignSystemIndex;
      try {
        designSystemIndex = JSON.parse(cachedIndex);
      } catch {
        figma.ui.postMessage({ type: 'error', message: 'Design system index is corrupted. Please re-index.' });
        break;
      }

      try {
        let productSpec;

        if (specText) {
          // Parse text input into ProductSpec
          figma.ui.postMessage({ type: 'loading', message: 'Parsing product specification...' });
          productSpec = parseTextSpec(specText);
        } else if (notionSpecUrl) {
          // Check Notion token
          if (!notionToken) {
            figma.ui.postMessage({ type: 'error', message: 'Please connect Notion first' });
            break;
          }

          // Extract Notion page ID
          const notionPageId = extractNotionPageId(notionSpecUrl);
          if (!notionPageId) {
            figma.ui.postMessage({ type: 'error', message: 'Invalid Notion page URL' });
            break;
          }

          // Parse the Notion spec
          figma.ui.postMessage({ type: 'loading', message: 'Fetching Notion page...' });
          productSpec = await parseProductSpec(notionToken, notionPageId);
        } else {
          figma.ui.postMessage({ type: 'error', message: 'Please provide a product specification' });
          break;
        }

        if (productSpec.screens.length === 0 && !productSpec.overview) {
          figma.ui.postMessage({
            type: 'error',
            message: 'Could not parse any screens or content from the specification.',
          });
          break;
        }

        // Step 2: Generate design schema with Claude
        figma.ui.postMessage({ type: 'loading', message: 'AI is generating design schema...' });
        let designSchema = await generateDesignSchema(anthropicKey, productSpec, designSystemIndex);

        // Step 3: Map component names to keys and validate
        designSchema = mapComponentNamesToKeys(designSchema, designSystemIndex);
        const validation = validateSchema(designSchema, designSystemIndex);

        if (!validation.valid) {
          figma.ui.postMessage({
            type: 'warning',
            message: `Some components not found: ${validation.errors.slice(0, 3).join(', ')}. Placeholders will be used.`,
          });
        }

        // Step 4: Generate Figma nodes
        figma.ui.postMessage({ type: 'loading', message: 'Creating design in Figma...' });
        const result = await generateFromSchema(designSchema);

        figma.ui.postMessage({
          type: 'generation-complete',
          result,
          specTitle: productSpec.title,
        });
      } catch (error) {
        figma.ui.postMessage({
          type: 'error',
          message: error instanceof Error ? error.message : 'Generation failed',
        });
      }
      break;
    }

    case 'generate-test-frame': {
      try {
        await generateTestFrame();
        figma.ui.postMessage({ type: 'test-frame-created' });
      } catch (error) {
        figma.ui.postMessage({
          type: 'error',
          message: error instanceof Error ? error.message : 'Failed to create test frame',
        });
      }
      break;
    }

    case 'close': {
      figma.closePlugin();
      break;
    }
  }
};

// Start the plugin
initialize();
