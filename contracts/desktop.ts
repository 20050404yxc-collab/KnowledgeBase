export type Bucket = '常用' | '在学' | '归档'
export type Scope = 'mixed' | 'files' | 'knowledge'
export interface Citation { id: string; source_id: string; name: string; locator: string; text: string; retained?: boolean }
export interface Knowledge {
  id: string; title: string; content: string; created_at: string; updated_at: string;
  generated: boolean; edited: boolean; bucket: Bucket; manual_bucket: Bucket | null;
  citations: Citation[]; model?: string; provider_name?: string
}
export interface Attachment { id: string; name: string; fingerprint: string; blocks: number; warnings: string[]; retained: boolean }
export interface Source { id: string; name: string; created_at: string; blocks: number; warnings: string[] }
export interface Recommendation { title: string; reason: string; preview: string; knowledge_id?: string }
export interface Provider {
  id: string; name: string; protocol: 'responses' | 'chat-completions' | 'anthropic';
  base_url: string; model: string; has_key: boolean; active: boolean;
  input_price: number | null; output_price: number | null; currency: string
}
export interface Attempt {
  id: string; purpose: string; provider: string; model: string; status: string;
  started_at: string; elapsed_ms: number; input_tokens: number | null;
  output_tokens: number | null; cost: number | null; currency: string
}
export interface Answer { content: string; knowledge?: Knowledge; citations: Citation[]; recommendations: Recommendation[]; notice: string }
export interface WorkerEvent { id: string; type: 'progress' | 'stream'; message?: string; delta?: string }
export interface DesktopAPI {
  version: string;
  request<T>(operation: string, params?: Record<string, unknown>, id?: string): Promise<T>;
  cancel(id: string): Promise<void>;
  chooseFiles(): Promise<string[]>;
  pathsForFiles(files: File[]): string[];
  onEvent(callback: (event: WorkerEvent) => void): () => void;
}
declare global { interface Window { knowledgeBase: DesktopAPI } }
