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
} from './src/integrations/notion';
import {
  formatSlackMessage,
  postToSlack,
  validateSlackWebhook,
  generateSlackText,
} from './src/integrations/slack';
import type { DiffResult } from './src/types';

const STORAGE_KEY_FIGMA_TOKEN = 'recapme_figma_token';
const STORAGE_KEY_LINEAR_TOKEN = 'recapme_linear_token';
const STORAGE_KEY_NOTION_TOKEN = 'recapme_notion_token';
const STORAGE_KEY_SLACK_WEBHOOK = 'recapme_slack_webhook';
const STORAGE_KEY_LINEAR_TEAM = 'recapme_linear_team';

// Show the plugin UI
figma.showUI(__html__, {
  width: 520,
  height: 700,
  themeColors: true,
});

// Initialize the plugin
async function initialize() {
  const fileKey = figma.fileKey;
  const [figmaToken, linearToken, notionToken, slackWebhook, linearTeam] = await Promise.all([
    figma.clientStorage.getAsync(STORAGE_KEY_FIGMA_TOKEN),
    figma.clientStorage.getAsync(STORAGE_KEY_LINEAR_TOKEN),
    figma.clientStorage.getAsync(STORAGE_KEY_NOTION_TOKEN),
    figma.clientStorage.getAsync(STORAGE_KEY_SLACK_WEBHOOK),
    figma.clientStorage.getAsync(STORAGE_KEY_LINEAR_TEAM),
  ]);

  figma.ui.postMessage({
    type: 'init',
    fileKey: fileKey || null,
    hasFigmaToken: !!figmaToken,
    hasLinearToken: !!linearToken,
    hasNotionToken: !!notionToken,
    hasSlackWebhook: !!slackWebhook,
    linearTeam: linearTeam || null,
    figmaToken: figmaToken || null,
    linearToken: linearToken || null,
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

    case 'close': {
      figma.closePlugin();
      break;
    }
  }
};

// Start the plugin
initialize();
