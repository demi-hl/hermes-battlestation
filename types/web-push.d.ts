declare module "web-push" {
  export function generateVAPIDKeys(): { publicKey: string; privateKey: string };
  export function setVapidDetails(
    mailto: string,
    publicKey: string,
    privateKey: string,
  ): void;
  export function sendNotification(
    subscription: any,
    payload: string,
    options?: any,
  ): Promise<void>;
}