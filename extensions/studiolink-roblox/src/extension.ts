/*---------------------------------------------------------------------------------------------
 *  Copyright (c) StudioLink contributors.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs/promises';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

interface ProjectSummary {
	placeId: string;
	placeDir: string;
	repoDir: string;
	hasRepo: boolean;
	scriptsCount: number;
	totalBytes: number;
	updatedAt?: string;
	placeName?: string;
	gameId?: string;
	jobId?: string;
	active?: boolean;
}

interface ScriptRecord {
	path: string;
	className?: string;
	source?: string;
	size?: number;
	uniqueId?: string;
	deleted?: boolean;
	updatedAt?: string;
}

interface RpcEnvelope {
	version: '1';
	type: string;
	requestId: string;
	placeId: string;
	payload: Record<string, unknown>;
}

type TreeNode = ProjectNode | InfoNode;

let projectProvider: StudioLinkProjectsProvider | undefined;
let daemonStatusItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void {
	const client = new StudioLinkDaemonClient();
	projectProvider = new StudioLinkProjectsProvider(client);
	const tree = vscode.window.createTreeView('studiolink.projects', {
		treeDataProvider: projectProvider,
		showCollapseAll: true
	});
	daemonStatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80);
	daemonStatusItem.command = 'studiolink.checkDaemon';
	daemonStatusItem.text = 'StudioLink $(radio-tower) probing';
	daemonStatusItem.tooltip = 'StudioLink daemon status';
	daemonStatusItem.show();

	context.subscriptions.push(
		tree,
		daemonStatusItem,
		vscode.commands.registerCommand('studiolink.refresh', () => projectProvider?.refresh()),
		vscode.commands.registerCommand('studiolink.checkDaemon', () => checkDaemon(client, true)),
		vscode.commands.registerCommand('studiolink.openProject', (node?: ProjectNode) => openProject(client, node)),
		vscode.commands.registerCommand('studiolink.applyActiveScript', () => applyActiveScript(client)),
		vscode.languages.registerInlineCompletionItemProvider([{ language: 'luau' }, { language: 'lua' }], new StudioLinkInlineProvider()),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('studiolink.daemonUrl') || event.affectsConfiguration('studiolink.projectDataDir')) {
				client.refreshConfiguration();
				projectProvider?.refresh();
				void checkDaemon(client, false);
			}
		})
	);

	void checkDaemon(client, false);
	void projectProvider.refresh();
}

export function deactivate(): void {
	daemonStatusItem?.dispose();
}

async function checkDaemon(client: StudioLinkDaemonClient, showMessage: boolean): Promise<void> {
	try {
		const health = await client.health();
		const version = typeof health.version === 'string' ? health.version : 'unknown';
		daemonStatusItem!.text = `StudioLink $(radio-tower) online ${version}`;
		daemonStatusItem!.backgroundColor = undefined;
		if (showMessage) {
			void vscode.window.showInformationMessage(`StudioLink daemon online. Version ${version}.`);
		}
	} catch (error) {
		daemonStatusItem!.text = 'StudioLink $(warning) offline';
		daemonStatusItem!.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
		if (showMessage) {
			void vscode.window.showWarningMessage(`StudioLink daemon offline: ${messageFromError(error)}`);
		}
	}
}

async function openProject(client: StudioLinkDaemonClient, node?: ProjectNode): Promise<void> {
	const project = node?.project ?? await chooseProject(client);
	if (!project) {
		return;
	}
	const target = project.hasRepo ? project.repoDir : project.placeDir;
	await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target), { forceNewWindow: false });
}

async function chooseProject(client: StudioLinkDaemonClient): Promise<ProjectSummary | undefined> {
	const projects = await readProjects(client);
	const items = projects.map(project => ({
		label: project.placeName || project.placeId,
		description: `${project.scriptsCount} scripts`,
		detail: project.hasRepo ? project.repoDir : project.placeDir,
		project
	}));
	return (await vscode.window.showQuickPick(items, { placeHolder: 'Open StudioLink Roblox project' }))?.project;
}

async function applyActiveScript(client: StudioLinkDaemonClient): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		void vscode.window.showWarningMessage('No active script editor.');
		return;
	}
	const document = editor.document;
	if (document.languageId !== 'luau' && document.languageId !== 'lua') {
		void vscode.window.showWarningMessage('Active document is not a Lua/Luau script.');
		return;
	}
	const project = await projectForDocument(client, document.uri);
	if (!project) {
		void vscode.window.showWarningMessage('Could not match this file to a StudioLink Roblox project.');
		return;
	}
	const scriptPath = await scriptPathForDocument(client, project, document.uri);
	if (!scriptPath) {
		void vscode.window.showWarningMessage('Could not map this file to a Roblox script path.');
		return;
	}
	await client.writeProjectScript(project.placeId, {
		path: scriptPath,
		source: document.getText(),
		origin: 'studiolink-vscode',
		pendingStudioDeploy: true,
		summary: `Updated ${scriptPath} from StudioLink Code`
	});
	void vscode.window.showInformationMessage(`Applied ${scriptPath} to Roblox Studio.`);
}

async function projectForDocument(client: StudioLinkDaemonClient, uri: vscode.Uri): Promise<ProjectSummary | undefined> {
	if (uri.scheme !== 'file') {
		return undefined;
	}
	const filePath = normalizePath(uri.fsPath);
	const projects = await readProjects(client);
	return projects.find(project => filePath.startsWith(`${normalizePath(project.repoDir)}${path.sep}`) || filePath.startsWith(`${normalizePath(project.placeDir)}${path.sep}`));
}

async function scriptPathForDocument(client: StudioLinkDaemonClient, project: ProjectSummary, uri: vscode.Uri): Promise<string | undefined> {
	const records = await readScripts(client, project);
	const filePath = normalizePath(uri.fsPath);
	const byFileName = records.find(record => {
		const expected = normalizePath(path.join(project.repoDir, `${safeFileName(record.path)}.lua`));
		return expected === filePath;
	});
	if (byFileName) {
		return byFileName.path;
	}
	const relative = path.relative(project.repoDir, filePath).replace(/\\/g, '/');
	if (!relative.startsWith('..')) {
		return relative.replace(/\.luau?$/i, '').replace(/\//g, '.');
	}
	return undefined;
}

class StudioLinkDaemonClient {
	private baseUrl = configuredDaemonUrl();

	refreshConfiguration(): void {
		this.baseUrl = configuredDaemonUrl();
	}

	async health(): Promise<Record<string, unknown>> {
		return this.getJson('/health');
	}

	async rpc(messageType: string, placeId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
		const token = await this.authToken();
		const envelope: RpcEnvelope = {
			version: '1',
			type: messageType,
			requestId: `studiolink-code-${Date.now()}`,
			placeId,
			payload
		};
		const response = await this.postJson('/rpc', token, envelope) as unknown as RpcEnvelope;
		if (response.type === 'error' || response.type === 'license:error') {
			throw new Error(typeof response.payload.message === 'string' ? response.payload.message : `Daemon rejected ${messageType}`);
		}
		return response.payload;
	}

	async listProjects(): Promise<ProjectSummary[]> {
		const response = await this.rpc('project:list', '__global__', {});
		return Array.isArray(response.projects) ? response.projects.filter(isProjectSummary) : [];
	}

	async listProjectScripts(placeId: string, includeSource = false): Promise<ScriptRecord[]> {
		const response = await this.rpc('project:scripts', placeId, { includeSource, includeDeleted: false });
		return Array.isArray(response.scripts) ? response.scripts.filter(isScriptRecord) : [];
	}

	async writeProjectScript(placeId: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
		return this.rpc('project:write', placeId, payload);
	}

	private async authToken(): Promise<string> {
		const response = await this.getJson('/auth-token');
		const token = response.token;
		if (typeof token !== 'string' || !token) {
			throw new Error('Daemon did not return an auth token.');
		}
		return token;
	}

	private async getJson(route: string): Promise<Record<string, unknown>> {
		return requestJson(`${this.baseUrl}${route}`, 'GET');
	}

	private async postJson(route: string, token: string, body: unknown): Promise<Record<string, unknown>> {
		return requestJson(`${this.baseUrl}${route}`, 'POST', token, body);
	}
}

class StudioLinkProjectsProvider implements vscode.TreeDataProvider<TreeNode> {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeNode | undefined>();
	readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
	private projects: ProjectSummary[] = [];
	private daemonOnline = false;

	constructor(private readonly client: StudioLinkDaemonClient) {}

	async refresh(): Promise<void> {
		try {
			this.projects = await readProjects(this.client);
			await this.client.health();
			this.daemonOnline = true;
		} catch {
			this.projects = await readProjectsFromCache();
			this.daemonOnline = false;
		}
		this.onDidChangeTreeDataEmitter.fire(undefined);
	}

	getTreeItem(element: TreeNode): vscode.TreeItem {
		if (element instanceof ProjectNode) {
			const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
			item.description = `${element.project.scriptsCount} scripts`;
			item.tooltip = element.project.repoDir;
			item.contextValue = 'studiolink.project';
			item.iconPath = new vscode.ThemeIcon('symbol-namespace');
			item.command = {
				command: 'studiolink.openProject',
				title: 'Open Roblox Project',
				arguments: [element]
			};
			return item;
		}
		const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
		item.description = element.description;
		item.iconPath = new vscode.ThemeIcon(element.icon);
		return item;
	}

	async getChildren(element?: TreeNode): Promise<TreeNode[]> {
		if (element instanceof ProjectNode) {
			const scripts = await readScripts(this.client, element.project);
			return scripts.slice(0, 40).map(script => new InfoNode(script.path, formatScriptMeta(script), 'file-code'));
		}
		if (this.projects.length === 0) {
			return [
				new InfoNode(this.daemonOnline ? 'No synced Roblox projects' : 'Daemon offline', this.daemonOnline ? 'Open Studio with the bridge plugin' : 'Start StudioLink daemon', this.daemonOnline ? 'folder' : 'warning')
			];
		}
		return this.projects.map(project => new ProjectNode(project));
	}
}

class ProjectNode {
	readonly label: string;

	constructor(readonly project: ProjectSummary) {
		this.label = project.placeName || project.placeId;
	}
}

class InfoNode {
	constructor(readonly label: string, readonly description: string, readonly icon: string) {}
}

class StudioLinkInlineProvider implements vscode.InlineCompletionItemProvider {
	provideInlineCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.InlineCompletionItem[] {
		if (!vscode.workspace.getConfiguration('studiolink').get<boolean>('inlineSuggestions', true)) {
			return [];
		}
		const prefix = document.lineAt(position.line).text.slice(0, position.character);
		const trimmed = prefix.trim();
		if (trimmed === 'local Players') {
			return [new vscode.InlineCompletionItem(' = game:GetService("Players")')];
		}
		if (trimmed === 'local ReplicatedStorage') {
			return [new vscode.InlineCompletionItem(' = game:GetService("ReplicatedStorage")')];
		}
		if (trimmed === 'local function onPlayerAdded') {
			return [new vscode.InlineCompletionItem('(player: Player)\n\t-- StudioLink: handle player lifecycle here\nend\n\nPlayers.PlayerAdded:Connect(onPlayerAdded)')];
		}
		if (trimmed.endsWith(':Connect(function')) {
			return [new vscode.InlineCompletionItem('()\n\t\nend)')];
		}
		return [];
	}
}

async function readProjects(client: StudioLinkDaemonClient): Promise<ProjectSummary[]> {
	try {
		const projects = await client.listProjects();
		if (projects.length > 0) {
			return projects;
		}
	} catch {
		// Fallback below keeps the tree useful when only the cache is available.
	}
	return readProjectsFromCache();
}

async function readProjectsFromCache(): Promise<ProjectSummary[]> {
	const base = configuredDataDir();
	const placesDir = path.join(base, 'places');
	const reposDir = path.join(base, 'repos');
	const entries = await fs.readdir(placesDir, { withFileTypes: true }).catch(() => []);
	const projects = await Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
		const placeId = entry.name;
		const placeDir = path.join(placesDir, placeId);
		const repoDir = path.join(reposDir, placeId);
		const scripts = await readScriptsFromRegistry(path.join(placeDir, 'scripts.json'));
		const stat = await fs.stat(repoDir).catch(() => undefined);
		return {
			placeId,
			placeDir,
			repoDir,
			hasRepo: Boolean(stat?.isDirectory()),
			scriptsCount: scripts.filter(script => script.deleted !== true).length,
			totalBytes: scripts.reduce((sum, script) => sum + (script.deleted === true ? 0 : script.size ?? 0), 0),
			updatedAt: newestTimestamp(scripts),
			placeName: await readPlaceName(placeDir)
		};
	}));
	return projects.sort((left, right) => (right.updatedAt || '').localeCompare(left.updatedAt || '') || left.placeId.localeCompare(right.placeId));
}

async function readScripts(client: StudioLinkDaemonClient, project: ProjectSummary): Promise<ScriptRecord[]> {
	try {
		return await client.listProjectScripts(project.placeId, true);
	} catch {
		return readScriptsFromCache(project);
	}
}

async function readScriptsFromCache(project: ProjectSummary): Promise<ScriptRecord[]> {
	return readScriptsFromRegistry(path.join(project.placeDir, 'scripts.json'));
}

async function readScriptsFromRegistry(registryPath: string): Promise<ScriptRecord[]> {
	const text = await fs.readFile(registryPath, 'utf8').catch(() => '');
	if (!text) {
		return [];
	}
	const parsed = JSON.parse(text) as { scripts?: unknown };
	return Array.isArray(parsed.scripts) ? parsed.scripts.filter(isScriptRecord) : [];
}

async function readPlaceName(placeDir: string): Promise<string | undefined> {
	const text = await fs.readFile(path.join(placeDir, 'place.json'), 'utf8').catch(() => '');
	if (!text) {
		return undefined;
	}
	const parsed = JSON.parse(text) as { placeName?: unknown; metadata?: { placeName?: unknown } };
	if (typeof parsed.metadata?.placeName === 'string') {
		return parsed.metadata.placeName;
	}
	return typeof parsed.placeName === 'string' ? parsed.placeName : undefined;
}

function isScriptRecord(value: unknown): value is ScriptRecord {
	return typeof value === 'object' && value !== null && typeof (value as { path?: unknown }).path === 'string';
}

function isProjectSummary(value: unknown): value is ProjectSummary {
	return typeof value === 'object' && value !== null && typeof (value as { placeId?: unknown }).placeId === 'string';
}

function newestTimestamp(scripts: ScriptRecord[]): string | undefined {
	return scripts.map(script => script.updatedAt).filter((value): value is string => typeof value === 'string').sort().at(-1);
}

function formatScriptMeta(script: ScriptRecord): string {
	const className = script.className || 'Script';
	const size = script.size ? `${script.size} bytes` : 'unknown size';
	return `${className}, ${size}`;
}

function configuredDaemonUrl(): string {
	return vscode.workspace.getConfiguration('studiolink').get<string>('daemonUrl', 'http://127.0.0.1:45678').replace(/\/$/, '');
}

function configuredDataDir(): string {
	const configured = vscode.workspace.getConfiguration('studiolink').get<string>('projectDataDir', '').trim();
	if (configured) {
		return configured;
	}
	if (process.platform === 'win32' && process.env.APPDATA) {
		return path.join(process.env.APPDATA, 'StudioLink');
	}
	return path.join(os.homedir(), '.studiolink');
}

function requestJson(url: string, method: 'GET' | 'POST', token?: string, body?: unknown): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const payload = body ? JSON.stringify(body) : '';
		const parsed = new URL(url);
		const request = http.request({
			hostname: parsed.hostname,
			port: parsed.port,
			path: `${parsed.pathname}${parsed.search}`,
			method,
			headers: {
				accept: 'application/json',
				'content-type': 'application/json',
				'content-length': Buffer.byteLength(payload),
				...(token ? { 'x-roagent-token': token } : {})
			},
			timeout: 4500
		}, response => {
			let text = '';
			response.setEncoding('utf8');
			response.on('data', chunk => { text += chunk; });
			response.on('end', () => {
				if ((response.statusCode ?? 500) >= 400) {
					reject(new Error(`HTTP ${response.statusCode}: ${text}`));
					return;
				}
				try {
					resolve(JSON.parse(text) as Record<string, unknown>);
				} catch (error) {
					reject(error);
				}
			});
		});
		request.on('timeout', () => {
			request.destroy(new Error('Timed out while contacting StudioLink daemon.'));
		});
		request.on('error', reject);
		request.end(payload);
	});
}

function safeFileName(scriptPath: string): string {
	return scriptPath.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function normalizePath(value: string): string {
	return path.normalize(value);
}

function messageFromError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
