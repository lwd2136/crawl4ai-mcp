#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
} from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';

interface CrawlRequest {
    urls: string[];
}

const API_URL = process.env.CRAWL4AI_API_URL || 'http://127.0.0.1:11235';
const AUTH_TOKEN = process.env.CRAWL4AI_AUTH_TOKEN;

// Default crawler configuration
const DEFAULT_CONFIG = {
    priority: 10,
    magic: true,
    crawler_params: {
        headless: true,
        page_timeout: 30000,
        remove_overlay_elements: true,
        browser_type: "chromium",
        scan_full_page: true,
        user_agent_mode: "random",
        user_agent_generator_config: {
            device_type: "mobile",
            os_type: "android"
        }
    },
    bypass_cache: true,
    ignore_images: true
};

const isValidCrawlRequest = (args: any): args is CrawlRequest => {
    if (!args || typeof args !== 'object') return false;
    if (!Array.isArray(args.urls) || !args.urls.every((url: string) => typeof url === 'string')) return false;
    return true;
};

class Crawl4AIServer {
    private server: Server;
    private axiosInstance;

    constructor() {
        this.server = new Server(
            {
                name: 'crawl4ai-mcp',
                version: '0.1.0',
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        this.axiosInstance = axios.create({
            baseURL: API_URL,
            headers: AUTH_TOKEN ? {
                'Authorization': `Bearer ${AUTH_TOKEN}`
            } : {}
        });

        this.setupToolHandlers();
        
        // Error handling
        this.server.onerror = (error) => console.error('[MCP Error]', error);
        process.on('SIGINT', async () => {
            await this.server.close();
            process.exit(0);
        });
    }

    private setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'crawl_urls',
                    description: 'Crawl one or more URLs and return markdown content with citations',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            urls: {
                                type: 'array',
                                items: {
                                    type: 'string'
                                },
                                description: 'Array of URLs to crawl'
                            }
                        },
                        required: ['urls']
                    }
                }
            ],
        }));

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            if (request.params.name !== 'crawl_urls') {
                throw new McpError(
                    ErrorCode.MethodNotFound,
                    `Unknown tool: ${request.params.name}`
                );
            }

            if (!isValidCrawlRequest(request.params.arguments)) {
                throw new McpError(
                    ErrorCode.InvalidParams,
                    'Invalid crawl request parameters'
                );
            }

            try {
                const response = await this.axiosInstance.post('/crawl_direct', {
                    ...DEFAULT_CONFIG,
                    urls: request.params.arguments.urls
                });
                
                if (!response.data || !response.data.results) {
                    throw new McpError(
                        ErrorCode.InternalError,
                        'Invalid response format from crawling service'
                    );
                }

                const markdownResults = response.data.results.map((result: any) => {
                    if (!result.markdown_v2 || !result.markdown_v2.markdown_with_citations) {
                        return 'Error: No markdown content available for this URL';
                    }
                    return result.markdown_v2.markdown_with_citations;
                });

                return {
                    content: [
                        {
                            type: 'text',
                            text: markdownResults.join('\n\n---\n\n')
                        }
                    ]
                };

            } catch (error) {
                if (axios.isAxiosError(error)) {
                    const message = error.response?.data?.message || error.message;
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Crawling service error: ${message}`
                            }
                        ],
                        isError: true
                    };
                }
                throw error;
            }
        });
    }

    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('Crawl4AI MCP server running on stdio');
    }
}

const server = new Crawl4AIServer();
server.run().catch(console.error);
