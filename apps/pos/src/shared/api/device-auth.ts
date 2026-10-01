type TokenReader = () => Promise<string | null>;

let readToken: TokenReader = () => Promise.resolve(null);

export function setDeviceTokenReader(reader: TokenReader): void {
  readToken = reader;
}

export function currentDeviceToken(): Promise<string | null> {
  return readToken();
}
