import type { Provider, Session, User } from "@supabase/supabase-js";
import { makeRedirectUri } from "expo-auth-session";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import Constants from "expo-constants";
import * as ExpoLinking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { supabase, supabaseUrl } from "./supabase";

WebBrowser.maybeCompleteAuthSession();

export const AUTH_PASSWORD_MIN_LENGTH = 8;
export const LOGIN_AUTH_REDIRECT_PATH = "login";
export const PASSWORD_RESET_REDIRECT_PATH = "reset-password";
export const NATIVE_GOOGLE_REDIRECT_URI = "schedova://login";

type NativeAppleSignInResult = {
  cancelled: boolean;
  session: Session | null;
};

type AuthCallbackTokens = {
  accessToken: string | null;
  refreshToken: string | null;
  code: string | null;
  type: string | null;
  errorCode: string | null;
  errorDescription: string | null;
};

function normalizePath(path: string) {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

function createNativeSchemeUri(path: string) {
  return `schedova://${normalizePath(path)}`;
}

function getAuthRedirectTarget(url: string) {
  const parsedUrl = ExpoLinking.parse(url);
  const parsedPath = normalizePath(parsedUrl.path ?? "");

  if (parsedPath) {
    return parsedPath;
  }

  const parsedHost = normalizePath(parsedUrl.hostname ?? "");

  if (parsedHost) {
    return parsedHost;
  }

  try {
    const urlObject = new URL(url);
    const pathname = normalizePath(urlObject.pathname ?? "");

    if (pathname) {
      return pathname;
    }

    return normalizePath(urlObject.hostname ?? "");
  } catch {
    return "";
  }
}

function getUrlParams(url: string) {
  const [baseUrl, hashFragment = ""] = url.split("#");
  const urlObject = new URL(baseUrl);
  const params = new URLSearchParams(urlObject.search);
  const hashParams = new URLSearchParams(hashFragment);

  hashParams.forEach((value, key) => {
    params.set(key, value);
  });

  return params;
}

function getOAuthProviderRedirectTarget(url: string) {
  try {
    return new URL(url).searchParams.get("redirect_to");
  } catch {
    return null;
  }
}

function extractAuthCallbackTokens(url: string): AuthCallbackTokens {
  const params = getUrlParams(url);

  return {
    accessToken: params.get("access_token"),
    refreshToken: params.get("refresh_token"),
    code: params.get("code"),
    type: params.get("type"),
    errorCode: params.get("error_code") ?? params.get("error"),
    errorDescription: params.get("error_description"),
  };
}

function formatAuthCallbackError({
  errorCode,
  errorDescription,
}: Pick<AuthCallbackTokens, "errorCode" | "errorDescription">) {
  if (errorDescription) {
    return errorDescription.replace(/\+/g, " ");
  }

  if (errorCode) {
    return errorCode.replace(/_/g, " ");
  }

  return "Authentication could not be completed.";
}

export function createAuthRedirectUri(path: string) {
  const normalizedPath = normalizePath(path);
  const nativeUri = createNativeSchemeUri(normalizedPath);

  if (Platform.OS === "ios" || Platform.OS === "android") {
    return nativeUri;
  }

  if (Platform.OS === "web") {
    return makeRedirectUri({
      path: normalizedPath,
      preferLocalhost: __DEV__,
      scheme: "schedova",
    });
  }

  return makeRedirectUri({
    path: normalizedPath,
    scheme: "schedova",
  });
}

export function matchesAuthRedirectPath(url: string, path: string) {
  return getAuthRedirectTarget(url) === normalizePath(path);
}

export function getAuthCallbackMetadata(url: string) {
  const tokens = extractAuthCallbackTokens(url);

  return {
    hasCode: Boolean(tokens.code),
    hasSessionTokens: Boolean(tokens.accessToken && tokens.refreshToken),
    redirectTarget: getAuthRedirectTarget(url),
  };
}

export function getGoogleOAuthRedirectUri() {
  return Platform.OS === "ios" || Platform.OS === "android"
    ? NATIVE_GOOGLE_REDIRECT_URI
    : createAuthRedirectUri(LOGIN_AUTH_REDIRECT_PATH);
}

export async function beginSocialAuth(provider: Provider) {
  const redirectTo =
    provider === "google"
      ? getGoogleOAuthRedirectUri()
      : createAuthRedirectUri(LOGIN_AUTH_REDIRECT_PATH);
  const queryParams =
    provider === "google"
      ? {
          prompt: "select_account",
        }
      : undefined;

  if (__DEV__ && provider === "google") {
    console.log("[GoogleOAuth] redirectTo", redirectTo);
    console.log("[GoogleOAuth] platform", Platform.OS);
    console.log("[GoogleOAuth] supabaseUrl", supabaseUrl);
    console.log(
      "[GoogleOAuth] executionEnvironment",
      Constants.executionEnvironment,
    );
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      queryParams,
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    throw error;
  }

  if (!data?.url) {
    throw new Error("Unable to open the social sign-in page.");
  }

  const providerUrlRedirectTo = getOAuthProviderRedirectTarget(data.url);

  if (__DEV__ && provider === "google") {
    console.log(
      "[GoogleOAuth] providerUrlRedirectTo",
      providerUrlRedirectTo,
    );
  }

  return {
    providerUrlRedirectTo,
    redirectTo,
    result: await WebBrowser.openAuthSessionAsync(data.url, redirectTo),
  };
}

function buildAppleFullName(
  fullName: AppleAuthentication.AppleAuthenticationFullName | null,
) {
  if (!fullName) {
    return null;
  }

  const parts = [
    fullName.givenName,
    fullName.middleName,
    fullName.familyName,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" ") : null;
}

function isAppleAuthCancellation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ERR_REQUEST_CANCELED"
  );
}

export async function isNativeAppleAuthAvailable() {
  return await AppleAuthentication.isAvailableAsync();
}

export async function beginNativeAppleSignIn(): Promise<NativeAppleSignInResult> {
  try {
    const rawNonce = Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce,
      { encoding: Crypto.CryptoEncoding.HEX },
    );
    const state = Crypto.randomUUID();

    if (__DEV__) {
      console.log("Apple nonce generated: true");
      console.log("Apple hashed nonce generated: true");
    }

    const credential = await AppleAuthentication.signInAsync({
      nonce: hashedNonce,
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      state,
    });

    if (!credential.identityToken) {
      throw new Error("Apple did not return a sign-in token.");
    }

    if (__DEV__) {
      console.log("Apple identity token present: true");
      console.log("Supabase signInWithIdToken called with raw nonce: true");
    }

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: "apple",
      token: credential.identityToken,
      nonce: rawNonce,
    });

    if (error) {
      throw error;
    }

    const fullName = buildAppleFullName(credential.fullName);

    if (
      data.user &&
      (fullName || credential.fullName?.givenName || credential.fullName?.familyName)
    ) {
      try {
        await supabase.auth.updateUser({
          data: {
            family_name: credential.fullName?.familyName ?? undefined,
            full_name: fullName ?? undefined,
            given_name: credential.fullName?.givenName ?? undefined,
          },
        });
      } catch (error) {
        if (__DEV__) {
          console.log("[Auth] Apple profile sync failed", {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return {
      cancelled: false,
      session: data.session,
    };
  } catch (error) {
    if (isAppleAuthCancellation(error)) {
      return {
        cancelled: true,
        session: null,
      };
    }

    throw error;
  }
}

export async function completeAuthSessionFromUrl(
  url: string,
  debugLabel = "Auth",
) {
  const tokens = extractAuthCallbackTokens(url);
  const logPrefix = `[${debugLabel}]`;

  if (tokens.errorCode) {
    throw new Error(formatAuthCallbackError(tokens));
  }

  if (tokens.accessToken && tokens.refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });

    if (error) {
      throw error;
    }

    const session =
      data.session ??
      (await supabase.auth.getSession()).data.session ??
      null;

    if (__DEV__) {
      console.log(`${logPrefix} exchangeCodeForSession success`, false);
      console.log(
        `${logPrefix} session exists after exchange`,
        Boolean(session),
      );
      console.log(
        `${logPrefix} user email if available`,
        session?.user?.email ?? null,
      );
    }

    return {
      session,
      type: tokens.type,
    };
  }

  if (tokens.code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(
      tokens.code,
    );

    const exchangeSucceeded = !error;

    if (error) {
      if (__DEV__) {
        console.log(`${logPrefix} exchangeCodeForSession success`, false);
      }
      throw error;
    }

    const session =
      data.session ??
      (await supabase.auth.getSession()).data.session ??
      null;

    if (__DEV__) {
      console.log(
        `${logPrefix} exchangeCodeForSession success`,
        exchangeSucceeded,
      );
      console.log(
        `${logPrefix} session exists after exchange`,
        Boolean(session),
      );
      console.log(
        `${logPrefix} user email if available`,
        session?.user?.email ?? null,
      );
    }

    return {
      session,
      type: tokens.type,
    };
  }

  if (__DEV__) {
    console.log(`${logPrefix} exchangeCodeForSession success`, false);
    console.log(`${logPrefix} session exists after exchange`, false);
    console.log(`${logPrefix} user email if available`, null);
  }

  return {
    session: null,
    type: tokens.type,
  };
}

export async function sendPasswordResetEmail(email: string) {
  return await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: createAuthRedirectUri(PASSWORD_RESET_REDIRECT_PATH),
  });
}

export function canChangePassword(user: User | null) {
  const providers = Array.isArray(user?.app_metadata?.providers)
    ? user.app_metadata.providers
    : [];

  return user?.app_metadata?.provider === "email" || providers.includes("email");
}

export function getSessionUserId(session: Session | null) {
  return session?.user?.id ?? null;
}
