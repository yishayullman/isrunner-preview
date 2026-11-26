import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashToken } from './crypto.mjs';
import {
  RateLimiter,
  applySecurityHeaders,
  isAllowedOrigin,
  parseCookies,
  sendError,
  sendJson,
} from './http-utils.mjs';
import {
  handleChangePassword,
  handleDeleteMyAccount,
  handleExportMyData,
  handleGetMe,
  handleLogin,
  handleLogout,
  handleLogoutAll,
  handleRegister,
  handleRequestPasswordReset,
  handleSendEmailVerificationCode,
  handleUpdateSettings,
  handleVerifyEmailCode,
} from './routes/auth.mjs';
import {
  handleCreateGpsRun,
  handleCreateRunClosed,
  handleDeleteRun,
  handleGetRun,
  handleListMyRuns,
  handleToggleRunShare,
  handleUpdateRunNote,
} from './routes/runs.mjs';
import {
  handleDeleteSourceData,
  handleDisconnectSource,
  handleGarminOAuthCallback,
  handleGarminWebhook,
  handleGetSources,
  handleProviderIngest,
  handleStartGarminConnect,
  handleStartStravaConnect,
  handleStravaOAuthCallback,
  handleStravaWebhookEvent,
  handleStravaWebhookVerify,
  handleSyncStrava,
} from './routes/ingest.mjs';
import { handleGetHome } from './routes/home.mjs';
import { handleGlobalLeaderboard } from './routes/leaderboard.mjs';
import {
  handleBlockUser,
  handleGetUserProfile,
  handleListFriends,
  handleRemoveFriend,
  handleRespondFriendRequest,
  handleSearchUsers,
  handleSendFriendRequest,
  handleUnblockUser,
} from './routes/friends.mjs';
import {
  handleListNotifications,
  handleMarkAllNotificationsRead,
  handleMarkNotificationRead,
} from './routes/notifications.mjs';
import {
  handleCreateGroup,
  handleGetGroupDetail,
  handleJoinGroup,
  handleLeaveGroup,
  handleListMyGroups,
  handlePreviewGroupByCode,
} from './routes/groups.mjs';
import { handleCreateReport, handleListMyReports } from './routes/reports.mjs';
import { handleGetResources } from './routes/resources.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function authenticateRequest(db, req) {
  const cookies = parseCookies(req.headers.cookie);
  const rawToken = cookies.isrunner_session;
  if (!rawToken) return { user: null, sessionTokenHash: null };

  const tokenHash = hashToken(rawToken);
  const nowIso = new Date().toISOString();
  const row = db
    .prepare(
      `SELECT u.*
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`
    )
    .get(tokenHash, nowIso);

  if (!row) return { user: null, sessionTokenHash: null };
  return { user: row, sessionTokenHash: tokenHash };
}

function serveStaticFile(res, pathname) {
  let relPath = pathname === '/' ? '/index.html' : pathname;
  // Prevent directory traversal
  const normalized = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
  let fullPath = path.join(PUBLIC_DIR, normalized);

  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    // SPA fallback to index.html for client-side routes
    fullPath = path.join(PUBLIC_DIR, 'index.html');
  }

  const ext = path.extname(fullPath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const content = fs.readFileSync(fullPath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
  });
  res.end(content);
}

export function createApp({ db, config = {} }) {
  const rateLimiter = new RateLimiter();
  const appConfig = {
    allowedOrigins: config.allowedOrigins || [],
    cookieSecure: Boolean(config.cookieSecure),
    publicBaseUrl: config.publicBaseUrl || '',
    garminClientId: config.garminClientId || config.garminConsumerKey || '',
    garminClientSecret: config.garminClientSecret || config.garminConsumerSecret || '',
    garminConsumerKey: config.garminConsumerKey || config.garminClientId || '',
    garminConsumerSecret: config.garminConsumerSecret || config.garminClientSecret || '',
    garminWebhookSecret: config.garminWebhookSecret || '',
    stravaClientId: config.stravaClientId || '',
    stravaClientSecret: config.stravaClientSecret || '',
    stravaWebhookVerifyToken: config.stravaWebhookVerifyToken || '',
    resendApiKey: config.resendApiKey || '',
    emailFrom: config.emailFrom || '',
    requireVerifiedEmailForLeaderboard: Boolean(config.requireVerifiedEmailForLeaderboard),
    fetchImpl: config.fetchImpl || null,
    authRateLimit: config.authRateLimit ?? 15,
    loginRateLimit: config.loginRateLimit ?? 10,
  };

  return async function requestHandler(req, res) {
    applySecurityHeaders(res);

    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;
      const method = req.method || 'GET';

      // Non-API requests serve static SPA assets
      if (!pathname.startsWith('/api/')) {
        if (method !== 'GET' && method !== 'HEAD') {
          return sendError(res, 405, 'method_not_allowed', 'שיטת בקשה לא נתמכת.');
        }
        return serveStaticFile(res, pathname);
      }

      // Health check
      if (pathname === '/api/health' && method === 'GET') {
        return sendJson(res, 200, { ok: true, app: 'Isrunner' });
      }

      const unauthCtx = { db, config: appConfig, rateLimiter, user: null, sessionTokenHash: null };

      // Server-to-server provider webhooks & ingestion (authenticated by provider secret/HMAC, NOT cookies/Origin)
      const ingestMatch = pathname.match(/^\/api\/ingest\/provider\/([a-z0-9_]+)$/);
      if (ingestMatch && method === 'POST') {
        return await handleProviderIngest(req, res, unauthCtx, ingestMatch[1]);
      }
      if (pathname === '/api/webhooks/garmin' && method === 'POST') {
        return await handleGarminWebhook(req, res, unauthCtx);
      }
      if (pathname === '/api/webhooks/strava' && method === 'GET') {
        return await handleStravaWebhookVerify(req, res, unauthCtx, url);
      }
      if (pathname === '/api/webhooks/strava' && method === 'POST') {
        return await handleStravaWebhookEvent(req, res, unauthCtx);
      }

      // OAuth 2.0 browser callbacks (authenticated via single-use server-side oauth_states.state)
      if (pathname === '/api/oauth/garmin/callback' && method === 'GET') {
        return await handleGarminOAuthCallback(req, res, unauthCtx, url);
      }
      if (pathname === '/api/oauth/strava/callback' && method === 'GET') {
        return await handleStravaOAuthCallback(req, res, unauthCtx, url);
      }

      // Enforce Origin check on ALL state-changing browser API requests
      if (WRITE_METHODS.has(method)) {
        if (!isAllowedOrigin(req, appConfig.allowedOrigins)) {
          return sendError(
            res,
            403,
            'invalid_origin',
            'בקשה נדחתה: מקור הבקשה (Origin) אינו מאושר לפעולה כותבת.'
          );
        }
      }

      const { user, sessionTokenHash } = authenticateRequest(db, req);
      const ctx = { db, config: appConfig, rateLimiter, user, sessionTokenHash };

      // Public auth routes
      if (pathname === '/api/auth/register' && method === 'POST') {
        return await handleRegister(req, res, ctx);
      }
      if (pathname === '/api/auth/login' && method === 'POST') {
        return await handleLogin(req, res, ctx);
      }
      if (pathname === '/api/auth/logout' && method === 'POST') {
        return await handleLogout(req, res, ctx);
      }
      if (pathname === '/api/auth/password-reset/request' && method === 'POST') {
        return await handleRequestPasswordReset(req, res, ctx);
      }
      if (pathname === '/api/auth/me' && method === 'GET') {
        return await handleGetMe(req, res, ctx);
      }

      // Resources can be read by logged-in users (or even before login, safe static info)
      if (pathname === '/api/resources' && method === 'GET') {
        return await handleGetResources(req, res, ctx);
      }

      // Everything below requires authentication
      if (!ctx.user) {
        return sendError(res, 401, 'unauthorized', 'נדרשת התחברות כדי לבצע פעולה זו.');
      }

      // Email verification OTP
      if (pathname === '/api/auth/email/send-code' && method === 'POST') {
        return await handleSendEmailVerificationCode(req, res, ctx);
      }
      if (pathname === '/api/auth/email/verify-code' && method === 'POST') {
        return await handleVerifyEmailCode(req, res, ctx);
      }

      // Settings, password, local export & account deletion
      if (pathname === '/api/auth/logout-all' && method === 'POST') {
        return await handleLogoutAll(req, res, ctx);
      }
      if (pathname === '/api/me/password' && method === 'POST') {
        return await handleChangePassword(req, res, ctx);
      }
      if (pathname === '/api/me/settings' && method === 'PATCH') {
        return await handleUpdateSettings(req, res, ctx);
      }
      if (pathname === '/api/me/export' && method === 'GET') {
        return await handleExportMyData(req, res, ctx);
      }
      if (pathname === '/api/me/account' && method === 'DELETE') {
        return await handleDeleteMyAccount(req, res, ctx);
      }

      // Home
      if (pathname === '/api/home' && method === 'GET') {
        return await handleGetHome(req, res, ctx);
      }

      // Runs
      if (pathname === '/api/runs' && method === 'POST') {
        return await handleCreateRunClosed(req, res, ctx);
      }
      if (pathname === '/api/runs/gps' && method === 'POST') {
        return await handleCreateGpsRun(req, res, ctx);
      }
      if (pathname === '/api/runs' && method === 'GET') {
        return await handleListMyRuns(req, res, ctx);
      }
      const runShareMatch = pathname.match(/^\/api\/runs\/([^/]+)\/share$/);
      if (runShareMatch && method === 'PATCH') {
        return await handleToggleRunShare(req, res, ctx, decodeURIComponent(runShareMatch[1]));
      }
      const runNoteMatch = pathname.match(/^\/api\/runs\/([^/]+)\/note$/);
      if (runNoteMatch && method === 'PATCH') {
        return await handleUpdateRunNote(req, res, ctx, decodeURIComponent(runNoteMatch[1]));
      }
      const runMatch = pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (runMatch && method === 'GET') {
        return await handleGetRun(req, res, ctx, decodeURIComponent(runMatch[1]));
      }
      if (runMatch && method === 'DELETE') {
        return await handleDeleteRun(req, res, ctx, decodeURIComponent(runMatch[1]));
      }

      // Measurement Sources (Garmin Connect + Strava)
      if (pathname === '/api/sources' && method === 'GET') {
        return await handleGetSources(req, res, ctx);
      }
      if (pathname === '/api/sources/garmin/connect' && method === 'POST') {
        return await handleStartGarminConnect(req, res, ctx);
      }
      if (pathname === '/api/sources/strava/connect' && method === 'POST') {
        return await handleStartStravaConnect(req, res, ctx);
      }
      if (pathname === '/api/sources/strava/sync' && method === 'POST') {
        return await handleSyncStrava(req, res, ctx);
      }
      const sourceDisconnectMatch = pathname.match(/^\/api\/sources\/([a-z0-9_]+)\/disconnect$/);
      if (sourceDisconnectMatch && method === 'POST') {
        return await handleDisconnectSource(req, res, ctx, sourceDisconnectMatch[1]);
      }
      const sourceDataMatch = pathname.match(/^\/api\/sources\/([a-z0-9_]+)\/data$/);
      if (sourceDataMatch && method === 'DELETE') {
        return await handleDeleteSourceData(req, res, ctx, sourceDataMatch[1]);
      }

      // Global Leaderboard
      if (pathname === '/api/leaderboard' && method === 'GET') {
        return await handleGlobalLeaderboard(req, res, ctx, url);
      }

      // Friends, Search, Block, Profiles
      if (pathname === '/api/friends' && method === 'GET') {
        return await handleListFriends(req, res, ctx);
      }
      if (pathname === '/api/users/search' && method === 'GET') {
        return await handleSearchUsers(req, res, ctx, url);
      }
      if (pathname === '/api/friends/requests' && method === 'POST') {
        return await handleSendFriendRequest(req, res, ctx);
      }
      const friendRespondMatch = pathname.match(/^\/api\/friends\/requests\/([^/]+)$/);
      if (friendRespondMatch && method === 'PATCH') {
        return await handleRespondFriendRequest(
          req,
          res,
          ctx,
          decodeURIComponent(friendRespondMatch[1])
        );
      }
      const friendRemoveMatch = pathname.match(/^\/api\/friends\/([^/]+)$/);
      if (friendRemoveMatch && method === 'DELETE') {
        return await handleRemoveFriend(req, res, ctx, decodeURIComponent(friendRemoveMatch[1]));
      }
      const blockMatch = pathname.match(/^\/api\/blocks\/([^/]+)$/);
      if (blockMatch && method === 'POST') {
        return await handleBlockUser(req, res, ctx, decodeURIComponent(blockMatch[1]));
      }
      if (blockMatch && method === 'DELETE') {
        return await handleUnblockUser(req, res, ctx, decodeURIComponent(blockMatch[1]));
      }
      const userProfileMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
      if (userProfileMatch && method === 'GET') {
        return await handleGetUserProfile(req, res, ctx, decodeURIComponent(userProfileMatch[1]));
      }

      // Notifications
      if (pathname === '/api/notifications' && method === 'GET') {
        return await handleListNotifications(req, res, ctx);
      }
      if (pathname === '/api/notifications/read-all' && method === 'POST') {
        return await handleMarkAllNotificationsRead(req, res, ctx);
      }
      const notifReadMatch = pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
      if (notifReadMatch && method === 'POST') {
        return await handleMarkNotificationRead(
          req,
          res,
          ctx,
          decodeURIComponent(notifReadMatch[1])
        );
      }

      // Groups
      if (pathname === '/api/groups' && method === 'GET') {
        return await handleListMyGroups(req, res, ctx);
      }
      if (pathname === '/api/groups' && method === 'POST') {
        return await handleCreateGroup(req, res, ctx);
      }
      if (pathname === '/api/groups/preview' && method === 'GET') {
        return await handlePreviewGroupByCode(req, res, ctx, url);
      }
      if (pathname === '/api/groups/join' && method === 'POST') {
        return await handleJoinGroup(req, res, ctx);
      }
      const groupLeaveMatch = pathname.match(/^\/api\/groups\/([^/]+)\/leave$/);
      if (groupLeaveMatch && method === 'POST') {
        return await handleLeaveGroup(req, res, ctx, decodeURIComponent(groupLeaveMatch[1]));
      }
      const groupDetailMatch = pathname.match(/^\/api\/groups\/([^/]+)$/);
      if (groupDetailMatch && method === 'GET') {
        return await handleGetGroupDetail(
          req,
          res,
          ctx,
          decodeURIComponent(groupDetailMatch[1]),
          url
        );
      }

      // Reports
      if (pathname === '/api/reports' && method === 'POST') {
        return await handleCreateReport(req, res, ctx);
      }
      if (pathname === '/api/reports/mine' && method === 'GET') {
        return await handleListMyReports(req, res, ctx);
      }

      return sendError(res, 404, 'not_found', 'הנתיב המבוקש לא נמצא.');
    } catch (err) {
      if (err && typeof err.status === 'number') {
        return sendError(res, err.status, 'request_error', err.message);
      }
      console.error('[Isrunner error]', err);
      return sendError(res, 500, 'internal_error', 'אירעה שגיאה פנימית בשרת.');
    }
  };
}
