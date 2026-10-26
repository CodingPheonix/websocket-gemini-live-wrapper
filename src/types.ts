export interface ParameterProperty {
  type: string;
  description?: string;
  required?: boolean | string[];
  enum?: string[];
  format?: string;
  minimum?: number;
  maximum?: number;
  nullable?: boolean;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  default?: any;
  example?: any;
  examples?: any[];
  properties?: Record<string, ParameterProperty>;
  items?: ParameterProperty | { type: string; [key: string]: any } | string;
  [key: string]: any;
}

export interface ToolParameters {
  type?: 'OBJECT' | 'object' | string;
  properties?: Record<string, ParameterProperty>;
  required?: string[];
  [key: string]: any;
}

export interface LiveTool {
  name: string;
  description: string;
  parameters?: ToolParameters | Record<string, ParameterProperty>;
  behavior?: 'BLOCKING' | 'NON_BLOCKING' | string;
  handler: (args: Record<string, any>) => any | Promise<any>;
}

export interface GeminiLiveOptions {
  prompt?: string;
  tools?: LiveTool | LiveTool[];
  enableLogs?: boolean;
  enableSessionResumption?: boolean;
  enableCompression?: boolean;
}

export interface VideoStreamOptions {
  fps?: number;
  maxWidth?: number;
  quality?: number;
  mimeType?: string;
}
