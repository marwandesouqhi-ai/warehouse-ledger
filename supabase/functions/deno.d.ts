// Type definitions for Supabase Edge Functions (Deno runtime) in IDE / TypeScript

declare namespace Deno {
  export interface Env {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
    toObject(): Record<string, string>;
  }
  export const env: Env;
}

declare module "https://deno.land/std@0.168.0/http/server.ts" {
  export function serve(
    handler: (req: Request) => Response | Promise<Response>,
    options?: { port?: number; onListen?: (params: { port: number; hostname: string }) => void }
  ): void;
}

declare module "https://deno.land/std@*/http/server.ts" {
  export function serve(
    handler: (req: Request) => Response | Promise<Response>,
    options?: { port?: number; onListen?: (params: { port: number; hostname: string }) => void }
  ): void;
}

declare module "https://esm.sh/@supabase/supabase-js@2" {
  export * from "@supabase/supabase-js";
}

declare module "https://esm.sh/@supabase/supabase-js*" {
  export * from "@supabase/supabase-js";
}

declare module "https://*" {
  const content: any;
  export default content;
  export const serve: any;
  export const createClient: any;
}

declare module "npm:nodemailer" {
  const nodemailer: any;
  export default nodemailer;
}

