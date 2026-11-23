export declare function handleRelay(request: Request, secret: string | undefined, now?: number): Promise<Response>;

declare const relay: {
  fetch(request: Request, context: unknown, env: { RELAY_SECRET?: string } | undefined): Promise<Response>;
};
export default relay;
