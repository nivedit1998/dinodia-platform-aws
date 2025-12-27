declare module 'qrcode' {
  type QRCodeErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

  export function toDataURL(
    text: string,
    options?: {
      errorCorrectionLevel?: QRCodeErrorCorrectionLevel;
      margin?: number;
      scale?: number;
    }
  ): Promise<string>;

  const _default: {
    toDataURL: typeof toDataURL;
  };
  export default _default;
}
