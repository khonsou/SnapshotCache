// The parent policy prevents child self-navigation; sandbox alone does not.
export const hostCSP = nonce => `default-src 'self'; script-src 'self'${nonce ? " 'nonce-" + nonce + "'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src blob:; object-src 'none'; base-uri 'none'; form-action 'self'`;
export function assetHeaders(asset, nonce) {
  return { 'Content-Type': asset.type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    ...(asset.snapshot ? { 'Content-Disposition': 'attachment', 'Content-Security-Policy': "default-src 'none'; sandbox" } : { 'Content-Security-Policy': hostCSP(nonce) }) };
}
