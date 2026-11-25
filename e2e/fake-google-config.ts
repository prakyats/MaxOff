/** The e2e's fake Google (v4.5, `e2e/fake-google.ts`): the port CI reserves next to the hold proxy's. */
export const FAKE_GOOGLE_PORT = 54332;
export const FAKE_GOOGLE_URL = `http://127.0.0.1:${FAKE_GOOGLE_PORT}`;

/** The e2e server's throwaway `DRIVE_TOKEN_KEY`: specs seal a fake refresh token with it. */
export const E2E_DRIVE_TOKEN_KEY = "ZTJlLW9ubHktZHJpdmUtdG9rZW4ta2V5LTMyLWJ5dGU=";
