declare module '@earendil-works/pi-coding-agent' {
  export interface ExtensionAPI {
    on(event: string, handler: (...args: any[]) => any): void;
    registerCommand(name: string, options: any): void;
  }
}