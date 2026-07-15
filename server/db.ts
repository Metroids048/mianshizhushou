import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInitialAppState } from "../src/lib/interviewEngine";
import type {
  AnswerCueCard,
  ApiStateSnapshot,
  BackendState,
  InterviewRecord,
  LiveCueSessionRecord,
  MockSessionRecord,
  Position,
  PromptRun,
  RagChunk,
  RagDocument,
  RagSourceType,
  RetrievalRun,
  SearchResult,
} from "./types";

// 未登录且未提供访客会话 id 时，退化为旧版单一共享状态，而不是每次读写都换成一个新的空状态（否则数据写入后立刻"消失"）。
const NO_ID_GUEST_KEY = "guest:__shared__";

export interface AppDb {
  db: Database.Database | null;
  mode: "sqlite" | "file";
  getState(userId?: string): BackendState;
  saveState(state: BackendState, userId?: string): void;
  saveCueCard(card: AnswerCueCard): void;
  listCueCards(): AnswerCueCard[];
  saveRecord(record: InterviewRecord, userId?: string): void;
  listRecords(userId?: string): InterviewRecord[];
  getRecord(id: string, userId?: string): InterviewRecord | undefined;
  saveSearchResult(result: SearchResult): void;
  savePromptRun(run: PromptRun, userId?: string): void;
  saveMockSession(session: MockSessionRecord, userId?: string): void;
  getMockSession(id: string, userId?: string): MockSessionRecord | undefined;
  getLatestActiveMockSession(positionId: string, userId?: string): MockSessionRecord | undefined;
  saveLiveCueSession(session: LiveCueSessionRecord, userId?: string): void;
  getLiveCueSession(id: string, userId?: string): LiveCueSessionRecord | undefined;
  getCachedCueCard(key: string): AnswerCueCard | undefined;
  saveCachedCueCard(key: string, card: AnswerCueCard, positionId: string): void;
  deleteCachedCueCardsByPosition(positionId: string): void;
  deletePositionArtifacts(positionId: string, userId?: string, ownerKey?: string): void;
  upsertDocument(document: RagDocument): void;
  replaceDocumentChunks(documentId: string, chunks: RagChunk[]): void;
  deleteDocument(sourceType: RagSourceType, sourceId: string, ownerKey?: string): void;
  deleteDocumentsBySource(sourceType: RagSourceType, positionId: string, ownerKey?: string): void;
  searchRagChunks(query: string, positionId?: string, ownerKey?: string): Array<RagChunk & { score: number }>;
  saveRetrievalRun(run: RetrievalRun, userId?: string): void;
  // Auth
  insertUser(user: UserRow): void;
  updateUser(user: UserRow): void;
  getUserByPhone(phone: string): UserRow | undefined;
  getUserByEmail(email: string): UserRow | undefined;
  getUserById(id: string): UserRow | undefined;
  getUserByEmailVerificationToken(tokenHash: string, afterDate: string): UserRow | undefined;
  getUserByPasswordResetToken(tokenHash: string, afterDate: string): UserRow | undefined;
  insertAuthIdentity(identity: AuthIdentityRow): void;
  insertSession(session: SessionRow): void;
  deleteSessionByJti(jti: string): void;
  deleteSessionsByUserId(userId: string): void;
  getSessionByJti(jti: string, afterDate: string): SessionRow | undefined;
  // Audio bridge devices
  insertAudioBridgeDevice(device: AudioBridgeDeviceRow): void;
  getAudioBridgeDeviceByTokenHash(tokenHash: string): AudioBridgeDeviceRow | undefined;
  touchAudioBridgeDevice(id: string, lastSeenAt: string): void;
  listAudioBridgeDevices(userId: string): AudioBridgeDeviceRow[];
  revokeAudioBridgeDevice(id: string, userId: string, revokedAt: string): void;
}

export interface UserRow {
  id: string;
  phone: string | null;
  email: string | null;
  displayName: string;
  passwordHash: string | null;
  emailVerifiedAt: string | null;
  emailVerificationTokenHash: string | null;
  emailVerificationExpiresAt: string | null;
  passwordResetTokenHash: string | null;
  passwordResetExpiresAt: string | null;
  deletedAt: string | null;
  notificationPrefs: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthIdentityRow {
  id: string;
  userId: string;
  provider: string;
  identifier: string;
  createdAt: string;
}

export interface SessionRow {
  id: string;
  userId: string;
  tokenJti: string;
  expiresAt: string;
  createdAt: string;
}

export interface AudioBridgeDeviceRow {
  id: string;
  userId: string;
  deviceName: string;
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

const DEFAULT_DB_PATH = ".data/ai-job-platform.sqlite";

type FileStore = {
  state: BackendState;
  userStates?: Record<string, BackendState>;
  cueCards: AnswerCueCard[];
  records: InterviewRecord[];
  userRecords?: Array<{ userId: string; record: InterviewRecord }>;
  searchResults: SearchResult[];
  promptRuns: PromptRun[];
  userPromptRuns?: Array<{ userId: string; run: PromptRun }>;
  mockSessions: MockSessionRecord[];
  userMockSessions?: Array<{ userId: string; session: MockSessionRecord }>;
  userLiveCueSessions?: Array<{ userId: string; session: LiveCueSessionRecord }>;
  cueCardCache: Array<{ cacheKey: string; positionId: string; card: AnswerCueCard; createdAt: string }>;
  documents: RagDocument[];
  documentChunks: RagChunk[];
  retrievalRuns: RetrievalRun[];
  userRetrievalRuns?: Array<{ userId: string; run: RetrievalRun }>;
  users: UserRow[];
  authIdentities: AuthIdentityRow[];
  sessions: SessionRow[];
  audioBridgeDevices?: AudioBridgeDeviceRow[];
};

export function createDb(dbPath = process.env.AI_JOB_DB_PATH ?? DEFAULT_DB_PATH): AppDb {
  const resolved = resolve(dbPath);
  mkdirSync(dirname(resolved), { recursive: true });
  const fallbackFilePath = resolve(process.env.AI_JOB_FILE_PATH ?? deriveFilePath(resolved));

  try {
    const db = new Database(resolved);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrate(db);
    return createSqliteDb(db);
  } catch {
    return createFileDb(fallbackFilePath);
  }
}

function normalizeUserRow(user: Partial<UserRow>): UserRow {
  return {
    id: String(user.id ?? ""),
    phone: user.phone ?? null,
    email: user.email ?? null,
    displayName: String(user.displayName ?? ""),
    passwordHash: user.passwordHash ?? null,
    emailVerifiedAt: user.emailVerifiedAt ?? null,
    emailVerificationTokenHash: user.emailVerificationTokenHash ?? null,
    emailVerificationExpiresAt: user.emailVerificationExpiresAt ?? null,
    passwordResetTokenHash: user.passwordResetTokenHash ?? null,
    passwordResetExpiresAt: user.passwordResetExpiresAt ?? null,
    deletedAt: user.deletedAt ?? null,
    notificationPrefs: typeof user.notificationPrefs === "string" ? user.notificationPrefs : "{}",
    createdAt: String(user.createdAt ?? ""),
    updatedAt: String(user.updatedAt ?? ""),
  };
}

function mapUserRow(row: Record<string, unknown>): UserRow {
  return normalizeUserRow({
    id: String(row.id ?? ""),
    phone: row.phone as string | null,
    email: row.email as string | null,
    displayName: String(row.display_name ?? ""),
    passwordHash: row.password_hash as string | null,
    emailVerifiedAt: row.email_verified_at as string | null,
    emailVerificationTokenHash: row.email_verification_token_hash as string | null,
    emailVerificationExpiresAt: row.email_verification_expires_at as string | null,
    passwordResetTokenHash: row.password_reset_token_hash as string | null,
    passwordResetExpiresAt: row.password_reset_expires_at as string | null,
    deletedAt: row.deleted_at as string | null,
    notificationPrefs: typeof row.notification_prefs === "string" ? String(row.notification_prefs) : "{}",
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  });
}

function createSqliteDb(db: Database.Database): AppDb {
  return {
    db,
    mode: "sqlite",
    getState(userId) {
      const key = userId || NO_ID_GUEST_KEY;
      const raw = db.prepare("select json from app_state where id = ?").get(key) as { json: string } | undefined;
      if (raw) return JSON.parse(raw.json) as BackendState;
      const initial = createInitialAppState();
      const state: BackendState = { profile: initial.profile, positions: initial.positions, records: [], journeyState: "guest" };
      this.saveState(state, key);
      return state;
    },
    saveState(state, userId) {
      const key = userId || NO_ID_GUEST_KEY;
      db.prepare("insert into app_state(id, json, updated_at, user_id) values (?, ?, ?, ?) on conflict(id) do update set json = excluded.json, updated_at = excluded.updated_at, user_id = excluded.user_id").run(
        key,
        JSON.stringify(state),
        new Date().toISOString(),
        userId ?? null,
      );
    },
    saveCueCard(card) {
      db.prepare("insert or replace into cue_cards(id, json, created_at) values (?, ?, ?)").run(card.id, JSON.stringify(card), card.createdAt);
    },
    listCueCards() {
      return db.prepare("select json from cue_cards order by created_at desc").all().map((row) => JSON.parse((row as { json: string }).json) as AnswerCueCard);
    },
    saveRecord(record, userId) {
      if (!userId) return;
      db.prepare("insert or replace into interview_records(id, mode, json, created_at, user_id) values (?, ?, ?, ?, ?)").run(
        record.id,
        record.mode,
        JSON.stringify(record),
        record.createdAt,
        userId ?? null,
      );
    },
    listRecords(userId) {
      if (!userId) return [];
      const rows = db.prepare("select json from interview_records where user_id = ? order by created_at desc").all(userId);
      return rows
        .map((row) => JSON.parse((row as { json: string }).json) as InterviewRecord);
    },
    getRecord(id, userId) {
      if (!userId) return undefined;
      const row = db.prepare("select json from interview_records where id = ? and user_id = ?").get(id, userId) as { json: string } | undefined;
      return row ? (JSON.parse(row.json) as InterviewRecord) : undefined;
    },
    saveSearchResult(result) {
      db.prepare("insert or replace into search_results(id, query, provider, json, created_at) values (?, ?, ?, ?, ?)").run(
        result.id,
        result.query,
        result.provider,
        JSON.stringify(result),
        result.createdAt,
      );
    },
    savePromptRun(run, userId) {
      if (!userId) return;
      db.prepare("insert into prompt_runs(id, skill_id, prompt_id, model, provider, status, latency_ms, retrieval_count, search_used, fallback_reason, json, created_at, user_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        run.id,
        run.skillId,
        run.promptId,
        run.model,
        run.provider,
        run.status,
        run.latencyMs,
        run.retrievalCount,
        Number(run.searchUsed),
        run.fallbackReason,
        JSON.stringify(run),
        run.createdAt,
        userId ?? null,
      );
    },
    saveMockSession(session, userId) {
      if (!userId) return;
      db.prepare("insert or replace into mock_sessions(id, position_id, json, updated_at, created_at, user_id) values (?, ?, ?, ?, ?, ?)").run(
        session.id,
        session.positionId,
        JSON.stringify(session),
        session.updatedAt,
        session.createdAt,
        userId ?? null,
      );
    },
    getMockSession(id, userId) {
      if (!userId) return undefined;
      const row = db.prepare("select json from mock_sessions where id = ? and user_id = ?").get(id, userId) as { json: string } | undefined;
      return row ? (JSON.parse(row.json) as MockSessionRecord) : undefined;
    },
    getLatestActiveMockSession(positionId, userId) {
      if (!userId) return undefined;
      const rows = db.prepare("select json from mock_sessions where position_id = ? and user_id = ? order by updated_at desc").all(positionId, userId) as Array<{ json: string }>;
      return rows
        .map((row) => JSON.parse(row.json) as MockSessionRecord)
        .find((session) => !session.completedAt);
    },
    saveLiveCueSession(session, userId) {
      if (!userId) return;
      db.prepare("insert or replace into live_cue_sessions(id, position_id, json, updated_at, created_at, user_id) values (?, ?, ?, ?, ?, ?)").run(
        session.id,
        session.positionId,
        JSON.stringify(session),
        session.updatedAt,
        session.createdAt,
        userId,
      );
    },
    getLiveCueSession(id, userId) {
      if (!userId) return undefined;
      const row = db.prepare("select json from live_cue_sessions where id = ? and user_id = ?").get(id, userId) as { json: string } | undefined;
      return row ? (JSON.parse(row.json) as LiveCueSessionRecord) : undefined;
    },
    getCachedCueCard(key) {
      const row = db.prepare("select json from cue_card_cache where cache_key = ?").get(key) as { json: string } | undefined;
      return row ? (JSON.parse(row.json) as AnswerCueCard) : undefined;
    },
    saveCachedCueCard(key, card, positionId) {
      db.prepare("insert or replace into cue_card_cache(cache_key, json, position_id, created_at) values (?, ?, ?, ?)").run(key, JSON.stringify(card), positionId, card.createdAt);
    },
    deleteCachedCueCardsByPosition(positionId) {
      db.prepare("delete from cue_card_cache where position_id = ?").run(positionId);
    },
    deletePositionArtifacts(positionId, userId, ownerKey) {
      db.prepare("delete from cue_card_cache where position_id = ?").run(positionId);
      if (userId) {
        db.prepare("delete from mock_sessions where position_id = ? and user_id = ?").run(positionId, userId);
        db.prepare("delete from live_cue_sessions where position_id = ? and user_id = ?").run(positionId, userId);
        db.prepare("delete from interview_records where json_extract(json, '$.positionId') = ? and user_id = ?").run(positionId, userId);
      }
      this.deleteDocumentsBySource("jd", positionId, ownerKey);
      this.deleteDocumentsBySource("question", positionId, ownerKey);
      this.deleteDocumentsBySource("material", positionId, ownerKey);
      this.deleteDocumentsBySource("record", positionId, ownerKey);
    },
    upsertDocument(document) {
      const existing = db
        .prepare("select id from documents where owner_key = ? and source_type = ? and source_id = ?")
        .get(document.ownerKey, document.sourceType, document.sourceId) as { id: string } | undefined;
      if (existing && existing.id !== document.id) {
        const chunkIds = db
          .prepare("select id from document_chunks where document_id = ?")
          .all(existing.id)
          .map((row) => (row as { id: string }).id);
        chunkIds.forEach((chunkId) => {
          db.prepare("delete from document_chunks_fts where chunk_id = ?").run(chunkId);
        });
        db.prepare("delete from document_chunks where document_id = ?").run(existing.id);
        db.prepare("delete from documents where id = ?").run(existing.id);
      }
      db.prepare(
        `
        insert into documents(id, position_id, source_type, source_id, source_sub_type, owner_key, title, summary, content, priority, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          position_id = excluded.position_id,
          source_type = excluded.source_type,
          source_id = excluded.source_id,
          source_sub_type = excluded.source_sub_type,
          owner_key = excluded.owner_key,
          title = excluded.title,
          summary = excluded.summary,
          content = excluded.content,
          priority = excluded.priority,
          updated_at = excluded.updated_at
      `,
      ).run(
        document.id,
        document.positionId ?? null,
        document.sourceType,
        document.sourceId,
        document.sourceSubType ?? null,
        document.ownerKey,
        document.title,
        document.summary,
        document.content,
        document.priority,
        document.createdAt,
        document.updatedAt,
      );
    },
    replaceDocumentChunks(documentId, chunks) {
      const existingChunkIds = db
        .prepare("select id from document_chunks where document_id = ?")
        .all(documentId)
        .map((row) => (row as { id: string }).id);
      existingChunkIds.forEach((chunkId) => {
        db.prepare("delete from document_chunks_fts where chunk_id = ?").run(chunkId);
      });
      db.prepare("delete from document_chunks where document_id = ?").run(documentId);
      const insertChunk = db.prepare(
        "insert into document_chunks(id, document_id, position_id, source_type, source_id, source_sub_type, owner_key, title, content, chunk_index, priority, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );
      const insertFts = db.prepare(
        "insert into document_chunks_fts(content, title, source_type, source_id, position_id, owner_key, chunk_id) values (?, ?, ?, ?, ?, ?, ?)",
      );
      const transaction = db.transaction((items: RagChunk[]) => {
        items.forEach((chunk) => {
          insertChunk.run(
            chunk.id,
            chunk.documentId,
            chunk.positionId ?? null,
            chunk.sourceType,
            chunk.sourceId,
            chunk.sourceSubType ?? null,
            chunk.ownerKey,
            chunk.title,
            chunk.content,
            chunk.chunkIndex,
            chunk.priority,
            chunk.createdAt,
            chunk.updatedAt,
          );
          insertFts.run(
            chunk.content,
            chunk.title,
            chunk.sourceType,
            chunk.sourceId,
            chunk.positionId ?? "",
            chunk.ownerKey,
            chunk.id,
          );
        });
      });
      transaction(chunks);
    },
    deleteDocument(sourceType, sourceId, ownerKey) {
      const ids = db
        .prepare("select id from documents where source_type = ? and source_id = ? and (? is null or owner_key = ?)")
        .all(sourceType, sourceId, ownerKey ?? null, ownerKey ?? null)
        .map((row) => (row as { id: string }).id);
      ids.forEach((id) => {
        const chunkIds = db
          .prepare("select id from document_chunks where document_id = ?")
          .all(id)
          .map((row) => (row as { id: string }).id);
        chunkIds.forEach((chunkId) => {
          db.prepare("delete from document_chunks_fts where chunk_id = ?").run(chunkId);
        });
        db.prepare("delete from document_chunks where document_id = ?").run(id);
      });
      db.prepare("delete from documents where source_type = ? and source_id = ? and (? is null or owner_key = ?)").run(sourceType, sourceId, ownerKey ?? null, ownerKey ?? null);
    },
    deleteDocumentsBySource(sourceType, positionId, ownerKey) {
      const ids = db
        .prepare("select id from documents where source_type = ? and position_id = ? and (? is null or owner_key = ?)")
        .all(sourceType, positionId, ownerKey ?? null, ownerKey ?? null)
        .map((row) => (row as { id: string }).id);
      ids.forEach((id) => {
        const chunkIds = db
          .prepare("select id from document_chunks where document_id = ?")
          .all(id)
          .map((row) => (row as { id: string }).id);
        chunkIds.forEach((chunkId) => {
          db.prepare("delete from document_chunks_fts where chunk_id = ?").run(chunkId);
        });
        db.prepare("delete from document_chunks where document_id = ?").run(id);
      });
      db.prepare("delete from documents where source_type = ? and position_id = ? and (? is null or owner_key = ?)").run(sourceType, positionId, ownerKey ?? null, ownerKey ?? null);
    },
    searchRagChunks(query, positionId, ownerKey) {
      const normalizedQuery = normalizeFtsQuery(query);
      if (!normalizedQuery) return [];
      const rows = db
        .prepare(
          `
          select
            c.id,
            c.document_id,
            c.position_id,
            c.source_type,
            c.source_id,
            c.source_sub_type,
            c.owner_key,
            c.title,
            c.content,
            c.chunk_index,
            c.priority,
            c.created_at,
            c.updated_at,
            bm25(document_chunks_fts) as score
          from document_chunks_fts
          join document_chunks c on c.id = document_chunks_fts.chunk_id
          where document_chunks_fts match ?
            and (? is null or c.position_id = ? or c.position_id is null or c.position_id = '')
            and (? is null or c.owner_key = ?)
          order by score
          limit 20
        `,
        )
        .all(normalizedQuery, positionId ?? null, positionId ?? null, ownerKey ?? null, ownerKey ?? null);
      return rows.map((row) => ({
        id: String((row as { id: string }).id),
        documentId: String((row as { document_id: string }).document_id),
        positionId: ((row as { position_id?: string }).position_id || undefined) as string | undefined,
        sourceType: String((row as { source_type: string }).source_type) as RagSourceType,
        sourceId: String((row as { source_id: string }).source_id),
        sourceSubType: ((row as { source_sub_type?: string }).source_sub_type || undefined) as string | undefined,
        ownerKey: String((row as { owner_key: string }).owner_key),
        title: String((row as { title: string }).title),
        content: String((row as { content: string }).content),
        chunkIndex: Number((row as { chunk_index: number }).chunk_index),
        priority: Number((row as { priority: number }).priority),
        createdAt: String((row as { created_at: string }).created_at),
        updatedAt: String((row as { updated_at: string }).updated_at),
        score: Number((row as { score: number }).score ?? 0),
      }));
    },
    saveRetrievalRun(run, userId) {
      if (!userId) return;
      db.prepare("insert into retrieval_runs(id, query, position_id, owner_key, chunk_ids_json, latency_ms, created_at, user_id) values (?, ?, ?, ?, ?, ?, ?, ?)").run(
        run.id,
        run.query,
        run.positionId ?? null,
        run.ownerKey,
        JSON.stringify(run.chunkIds),
        run.latencyMs,
        run.createdAt,
        userId ?? null,
      );
    },
    insertUser(user) {
      db.prepare("insert into users(id, phone, email, display_name, password_hash, email_verified_at, email_verification_token_hash, email_verification_expires_at, password_reset_token_hash, password_reset_expires_at, deleted_at, notification_prefs, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        user.id,
        user.phone,
        user.email,
        user.displayName,
        user.passwordHash,
        user.emailVerifiedAt,
        user.emailVerificationTokenHash,
        user.emailVerificationExpiresAt,
        user.passwordResetTokenHash,
        user.passwordResetExpiresAt,
        user.deletedAt,
        user.notificationPrefs,
        user.createdAt,
        user.updatedAt,
      );
    },
    updateUser(user) {
      db.prepare("update users set phone = ?, email = ?, display_name = ?, password_hash = ?, email_verified_at = ?, email_verification_token_hash = ?, email_verification_expires_at = ?, password_reset_token_hash = ?, password_reset_expires_at = ?, deleted_at = ?, notification_prefs = ?, updated_at = ? where id = ?").run(
        user.phone,
        user.email,
        user.displayName,
        user.passwordHash,
        user.emailVerifiedAt,
        user.emailVerificationTokenHash,
        user.emailVerificationExpiresAt,
        user.passwordResetTokenHash,
        user.passwordResetExpiresAt,
        user.deletedAt,
        user.notificationPrefs,
        user.updatedAt,
        user.id,
      );
    },
    getUserByPhone(phone) {
      const row = db.prepare("select id, phone, email, display_name, password_hash, email_verified_at, email_verification_token_hash, email_verification_expires_at, password_reset_token_hash, password_reset_expires_at, deleted_at, notification_prefs, created_at, updated_at from users where phone = ?").get(phone) as Record<string, unknown> | undefined;
      return row ? mapUserRow(row) : undefined;
    },
    getUserByEmail(email) {
      const row = db.prepare("select id, phone, email, display_name, password_hash, email_verified_at, email_verification_token_hash, email_verification_expires_at, password_reset_token_hash, password_reset_expires_at, deleted_at, notification_prefs, created_at, updated_at from users where lower(email) = lower(?)").get(email) as Record<string, unknown> | undefined;
      return row ? mapUserRow(row) : undefined;
    },
    getUserById(id) {
      const row = db.prepare("select id, phone, email, display_name, password_hash, email_verified_at, email_verification_token_hash, email_verification_expires_at, password_reset_token_hash, password_reset_expires_at, deleted_at, notification_prefs, created_at, updated_at from users where id = ?").get(id) as Record<string, unknown> | undefined;
      return row ? mapUserRow(row) : undefined;
    },
    getUserByEmailVerificationToken(tokenHash, afterDate) {
      const row = db.prepare("select id, phone, email, display_name, password_hash, email_verified_at, email_verification_token_hash, email_verification_expires_at, password_reset_token_hash, password_reset_expires_at, deleted_at, notification_prefs, created_at, updated_at from users where email_verification_token_hash = ? and email_verification_expires_at > ?").get(tokenHash, afterDate) as Record<string, unknown> | undefined;
      return row ? mapUserRow(row) : undefined;
    },
    getUserByPasswordResetToken(tokenHash, afterDate) {
      const row = db.prepare("select id, phone, email, display_name, password_hash, email_verified_at, email_verification_token_hash, email_verification_expires_at, password_reset_token_hash, password_reset_expires_at, deleted_at, notification_prefs, created_at, updated_at from users where password_reset_token_hash = ? and password_reset_expires_at > ?").get(tokenHash, afterDate) as Record<string, unknown> | undefined;
      return row ? mapUserRow(row) : undefined;
    },
    insertAuthIdentity(identity) {
      db.prepare("insert into auth_identities(id, user_id, provider, identifier, created_at) values (?, ?, ?, ?, ?)").run(
        identity.id, identity.userId, identity.provider, identity.identifier, identity.createdAt,
      );
    },
    insertSession(session) {
      db.prepare("insert into user_sessions(id, user_id, token_jti, expires_at, created_at) values (?, ?, ?, ?, ?)").run(
        session.id, session.userId, session.tokenJti, session.expiresAt, session.createdAt,
      );
    },
    deleteSessionByJti(jti) {
      db.prepare("delete from user_sessions where token_jti = ?").run(jti);
    },
    deleteSessionsByUserId(userId) {
      db.prepare("delete from user_sessions where user_id = ?").run(userId);
    },
    getSessionByJti(jti, afterDate) {
      const row = db.prepare("select id, user_id, token_jti, expires_at, created_at from user_sessions where token_jti = ? and expires_at > ?").get(jti, afterDate) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return { id: String(row.id ?? ""), userId: String(row.user_id ?? ""), tokenJti: String(row.token_jti ?? ""), expiresAt: String(row.expires_at ?? ""), createdAt: String(row.created_at ?? "") };
    },
    insertAudioBridgeDevice(device) {
      db.prepare(
        "insert into audio_bridge_devices(id, user_id, device_name, token_hash, created_at, last_seen_at, revoked_at) values (?, ?, ?, ?, ?, ?, ?)",
      ).run(device.id, device.userId, device.deviceName, device.tokenHash, device.createdAt, device.lastSeenAt, device.revokedAt);
    },
    getAudioBridgeDeviceByTokenHash(tokenHash) {
      const row = db
        .prepare("select id, user_id, device_name, token_hash, created_at, last_seen_at, revoked_at from audio_bridge_devices where token_hash = ? and revoked_at is null")
        .get(tokenHash) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return mapAudioBridgeDeviceRow(row);
    },
    touchAudioBridgeDevice(id, lastSeenAt) {
      db.prepare("update audio_bridge_devices set last_seen_at = ? where id = ?").run(lastSeenAt, id);
    },
    listAudioBridgeDevices(userId) {
      const rows = db
        .prepare("select id, user_id, device_name, token_hash, created_at, last_seen_at, revoked_at from audio_bridge_devices where user_id = ? and revoked_at is null order by last_seen_at desc")
        .all(userId) as Array<Record<string, unknown>>;
      return rows.map(mapAudioBridgeDeviceRow);
    },
    revokeAudioBridgeDevice(id, userId, revokedAt) {
      db.prepare("update audio_bridge_devices set revoked_at = ? where id = ? and user_id = ?").run(revokedAt, id, userId);
    },
  };
}

function mapAudioBridgeDeviceRow(row: Record<string, unknown>): AudioBridgeDeviceRow {
  return {
    id: String(row.id ?? ""),
    userId: String(row.user_id ?? ""),
    deviceName: String(row.device_name ?? ""),
    tokenHash: String(row.token_hash ?? ""),
    createdAt: String(row.created_at ?? ""),
    lastSeenAt: String(row.last_seen_at ?? ""),
    revokedAt: row.revoked_at == null ? null : String(row.revoked_at),
  };
}

function createFileDb(filePath: string): AppDb {
  mkdirSync(dirname(filePath), { recursive: true });
  const readStore = (): FileStore => {
    if (!existsSync(filePath)) {
      const initial = createInitialAppState();
      return {
        state: { profile: initial.profile, positions: initial.positions, records: [], journeyState: "guest" },
        userStates: {},
        cueCards: [],
        records: [],
        userRecords: [],
        searchResults: [],
        promptRuns: [],
        userPromptRuns: [],
        mockSessions: [],
        userMockSessions: [],
        userLiveCueSessions: [],
        cueCardCache: [],
        documents: [],
        documentChunks: [],
        retrievalRuns: [],
        userRetrievalRuns: [],
        users: [],
        authIdentities: [],
        sessions: [],
        audioBridgeDevices: [],
      };
    }
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<FileStore>;
    const initial = createInitialAppState();
    return {
      state: parsed.state ?? { profile: initial.profile, positions: initial.positions, records: [], journeyState: "guest" },
      userStates: parsed.userStates ?? {},
      cueCards: parsed.cueCards ?? [],
      records: parsed.records ?? [],
      userRecords: parsed.userRecords ?? [],
      searchResults: parsed.searchResults ?? [],
      promptRuns: parsed.promptRuns ?? [],
      userPromptRuns: parsed.userPromptRuns ?? [],
      mockSessions: parsed.mockSessions ?? [],
      userMockSessions: parsed.userMockSessions ?? [],
      userLiveCueSessions: parsed.userLiveCueSessions ?? [],
      cueCardCache: parsed.cueCardCache ?? [],
      documents: parsed.documents ?? [],
      documentChunks: parsed.documentChunks ?? [],
      retrievalRuns: parsed.retrievalRuns ?? [],
      userRetrievalRuns: parsed.userRetrievalRuns ?? [],
      users: (parsed.users ?? []).map((item) => normalizeUserRow(item)),
      authIdentities: parsed.authIdentities ?? [],
      sessions: parsed.sessions ?? [],
      audioBridgeDevices: parsed.audioBridgeDevices ?? [],
    };
  };
  const writeStore = (store: FileStore) => {
    writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
  };

  const replace = (updater: (store: FileStore) => FileStore) => {
    const next = updater(readStore());
    writeStore(next);
    return next;
  };

  return {
    db: null,
    mode: "file",
    getState(userId: string | undefined) {
      const key = userId || NO_ID_GUEST_KEY;
      const store = readStore();
      return store.userStates?.[key] ?? store.state;
    },
    saveState(state: BackendState, userId: string | undefined) {
      const key = userId || NO_ID_GUEST_KEY;
      replace((store) => ({
        ...store,
        userStates: { ...(store.userStates ?? {}), [key]: state },
      }));
    },
    saveCueCard(card) {
      replace((store) => ({ ...store, cueCards: [card, ...store.cueCards.filter((item) => item.id !== card.id)] }));
    },
    listCueCards() {
      return readStore().cueCards;
    },
    saveRecord(record, userId) {
      if (!userId) return;
      replace((store) => ({
        ...store,
        userRecords: [
          { userId, record },
          ...(store.userRecords ?? []).filter((item) => !(item.userId === userId && item.record.id === record.id)),
        ],
        userStates: {
          ...(store.userStates ?? {}),
          [userId]: {
            ...(store.userStates?.[userId] ?? store.state),
            records: [record, ...(store.userStates?.[userId]?.records ?? []).filter((item) => item.id !== record.id)],
          },
        },
      }));
    },
    listRecords(userId) {
      if (!userId) return [];
      return (readStore().userRecords ?? []).filter((item) => item.userId === userId).map((item) => item.record);
    },
    getRecord(id, userId) {
      if (!userId) return undefined;
      return (readStore().userRecords ?? []).find((item) => item.userId === userId && item.record.id === id)?.record;
    },
    saveSearchResult(result) {
      replace((store) => ({ ...store, searchResults: [result, ...store.searchResults.filter((item) => item.id !== result.id)] }));
    },
    savePromptRun(run, userId) {
      if (!userId) return;
      replace((store) => ({ ...store, userPromptRuns: [{ userId, run }, ...(store.userPromptRuns ?? [])] }));
    },
    saveMockSession(session, userId) {
      if (!userId) return;
      replace((store) => ({
        ...store,
        userMockSessions: [
          { userId, session },
          ...(store.userMockSessions ?? []).filter((item) => !(item.userId === userId && item.session.id === session.id)),
        ],
      }));
    },
    getMockSession(id, userId) {
      if (!userId) return undefined;
      return (readStore().userMockSessions ?? []).find((item) => item.userId === userId && item.session.id === id)?.session;
    },
    getLatestActiveMockSession(positionId, userId) {
      if (!userId) return undefined;
      return (readStore().userMockSessions ?? [])
        .filter((item) => item.userId === userId && item.session.positionId === positionId && !item.session.completedAt)
        .map((item) => item.session)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    },
    saveLiveCueSession(session, userId) {
      if (!userId) return;
      replace((store) => ({
        ...store,
        userLiveCueSessions: [
          { userId, session },
          ...(store.userLiveCueSessions ?? []).filter((item) => !(item.userId === userId && item.session.id === session.id)),
        ],
      }));
    },
    getLiveCueSession(id, userId) {
      if (!userId) return undefined;
      return (readStore().userLiveCueSessions ?? []).find((item) => item.userId === userId && item.session.id === id)?.session;
    },
    getCachedCueCard(key) {
      return readStore().cueCardCache.find((item) => item.cacheKey === key)?.card;
    },
    saveCachedCueCard(key, card, positionId) {
      replace((store) => ({
        ...store,
        cueCardCache: [
          { cacheKey: key, positionId, card, createdAt: card.createdAt },
          ...store.cueCardCache.filter((item) => item.cacheKey !== key),
        ],
      }));
    },
    deleteCachedCueCardsByPosition(positionId) {
      replace((store) => ({ ...store, cueCardCache: store.cueCardCache.filter((item) => item.positionId !== positionId) }));
    },
    deletePositionArtifacts(positionId, userId, ownerKey) {
      replace((store) => {
        const userStates = { ...(store.userStates ?? {}) };
        if (userId && userStates[userId]) {
          userStates[userId] = {
            ...userStates[userId],
            positions: userStates[userId].positions.filter((item) => item.id !== positionId),
            records: userStates[userId].records.filter((item) => item.positionId !== positionId),
          };
        }
        return {
          ...store,
          userRecords: userId ? (store.userRecords ?? []).filter((item) => !(item.userId === userId && item.record.positionId === positionId)) : store.userRecords ?? [],
          userMockSessions: userId ? (store.userMockSessions ?? []).filter((item) => !(item.userId === userId && item.session.positionId === positionId)) : store.userMockSessions ?? [],
          userLiveCueSessions: userId ? (store.userLiveCueSessions ?? []).filter((item) => !(item.userId === userId && item.session.positionId === positionId)) : store.userLiveCueSessions ?? [],
          cueCardCache: store.cueCardCache.filter((item) => item.positionId !== positionId),
          documents: store.documents.filter((item) => item.positionId !== positionId || (ownerKey && item.ownerKey !== ownerKey)),
          documentChunks: store.documentChunks.filter((item) => item.positionId !== positionId || (ownerKey && item.ownerKey !== ownerKey)),
          userStates,
        };
      });
    },
    upsertDocument(document) {
      replace((store) => ({
        ...store,
        documents: [
          document,
          ...store.documents.filter(
            (item) =>
              item.id !== document.id &&
              !(item.ownerKey === document.ownerKey && item.sourceType === document.sourceType && item.sourceId === document.sourceId),
          ),
        ],
      }));
    },
    replaceDocumentChunks(documentId, chunks) {
      replace((store) => ({
        ...store,
        documentChunks: [...chunks, ...store.documentChunks.filter((item) => item.documentId !== documentId)],
      }));
    },
    deleteDocument(sourceType, sourceId, ownerKey) {
      replace((store) => {
        const removedIds = store.documents
          .filter((item) => item.sourceType === sourceType && item.sourceId === sourceId && (!ownerKey || item.ownerKey === ownerKey))
          .map((item) => item.id);
        return {
          ...store,
          documents: store.documents.filter((item) => !(item.sourceType === sourceType && item.sourceId === sourceId && (!ownerKey || item.ownerKey === ownerKey))),
          documentChunks: store.documentChunks.filter((item) => !removedIds.includes(item.documentId)),
        };
      });
    },
    deleteDocumentsBySource(sourceType, positionId, ownerKey) {
      replace((store) => {
        const removedIds = store.documents
          .filter((item) => item.sourceType === sourceType && item.positionId === positionId && (!ownerKey || item.ownerKey === ownerKey))
          .map((item) => item.id);
        return {
          ...store,
          documents: store.documents.filter((item) => !(item.sourceType === sourceType && item.positionId === positionId && (!ownerKey || item.ownerKey === ownerKey))),
          documentChunks: store.documentChunks.filter((item) => !removedIds.includes(item.documentId)),
        };
      });
    },
    searchRagChunks(query, positionId, ownerKey) {
      const terms = normalizeSearchTerms(query).map((item) => item.toLowerCase());
      if (!terms.length) return [];
      const chunks = (readStore().documentChunks ?? []).filter((item) => {
        const samePosition = !positionId || item.positionId === positionId || !item.positionId;
        const sameOwner = !ownerKey || item.ownerKey === ownerKey;
        return samePosition && sameOwner;
      });
      return chunks
        .map((chunk) => {
          const haystack = `${chunk.title}\n${chunk.content}`.toLowerCase();
          const hits = terms.reduce((count, term) => (haystack.includes(term) ? count + 1 : count), 0);
          return { ...chunk, score: hits ? 1 / hits : 999 };
        })
        .sort((a, b) => a.score - b.score)
        .slice(0, 20);
    },
    saveRetrievalRun(run, userId) {
      if (!userId) return;
      replace((store) => ({ ...store, userRetrievalRuns: [{ userId, run }, ...(store.userRetrievalRuns ?? [])] }));
    },
    insertUser(user) {
      replace((store) => ({ ...store, users: [...store.users, normalizeUserRow(user)] }));
    },
    updateUser(user) {
      replace((store) => ({
        ...store,
        users: store.users.map((item) => (item.id === user.id ? normalizeUserRow(user) : item)),
      }));
    },
    getUserByPhone(phone) {
      return readStore().users.find((u) => u.phone === phone);
    },
    getUserByEmail(email) {
      return readStore().users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    },
    getUserById(id) {
      return readStore().users.find((u) => u.id === id);
    },
    getUserByEmailVerificationToken(tokenHash, afterDate) {
      return readStore().users.find((u) => u.emailVerificationTokenHash === tokenHash && (u.emailVerificationExpiresAt ?? "") > afterDate);
    },
    getUserByPasswordResetToken(tokenHash, afterDate) {
      return readStore().users.find((u) => u.passwordResetTokenHash === tokenHash && (u.passwordResetExpiresAt ?? "") > afterDate);
    },
    insertAuthIdentity(identity) {
      replace((store) => ({ ...store, authIdentities: [...store.authIdentities, identity] }));
    },
    insertSession(session) {
      replace((store) => ({ ...store, sessions: [...store.sessions, session] }));
    },
    deleteSessionByJti(jti) {
      replace((store) => ({ ...store, sessions: store.sessions.filter((s) => s.tokenJti !== jti) }));
    },
    deleteSessionsByUserId(userId) {
      replace((store) => ({ ...store, sessions: store.sessions.filter((s) => s.userId !== userId) }));
    },
    getSessionByJti(jti, afterDate) {
      return readStore().sessions.find((s) => s.tokenJti === jti && s.expiresAt > afterDate);
    },
    insertAudioBridgeDevice(device) {
      replace((store) => ({ ...store, audioBridgeDevices: [...(store.audioBridgeDevices ?? []), device] }));
    },
    getAudioBridgeDeviceByTokenHash(tokenHash) {
      return readStore().audioBridgeDevices?.find((d) => d.tokenHash === tokenHash && !d.revokedAt);
    },
    touchAudioBridgeDevice(id, lastSeenAt) {
      replace((store) => ({
        ...store,
        audioBridgeDevices: (store.audioBridgeDevices ?? []).map((d) => (d.id === id ? { ...d, lastSeenAt } : d)),
      }));
    },
    listAudioBridgeDevices(userId) {
      return (readStore().audioBridgeDevices ?? []).filter((d) => d.userId === userId && !d.revokedAt);
    },
    revokeAudioBridgeDevice(id, userId, revokedAt) {
      replace((store) => ({
        ...store,
        audioBridgeDevices: (store.audioBridgeDevices ?? []).map((d) => (d.id === id && d.userId === userId ? { ...d, revokedAt } : d)),
      }));
    },
  };
}

function migrate(db: Database.Database): void {
  const migrationPath = resolve("server/migrations/001_init.sql");
  const sql = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
  if (sql.trim()) db.exec(sql);

  // Phase 1.1: Auth tables
  const authMigrationPath = resolve("server/migrations/002_auth.sql");
  const authSql = existsSync(authMigrationPath) ? readFileSync(authMigrationPath, "utf8") : "";
  if (authSql.trim()) db.exec(authSql);

  // Phase 1.2: user_id columns
  const userIdMigrationPath = resolve("server/migrations/003_user_id.sql");
  const userIdSql = existsSync(userIdMigrationPath) ? readFileSync(userIdMigrationPath, "utf8") : "";
  if (userIdSql.trim()) {
    try {
      db.exec(userIdSql);
    } catch {
      // Columns may already exist — not fatal
    }
  }

  // Phase 2: quota ledger
  const quotaMigrationPath = resolve("server/migrations/004_quota.sql");
  const quotaSql = existsSync(quotaMigrationPath) ? readFileSync(quotaMigrationPath, "utf8") : "";
  if (quotaSql.trim()) {
    try {
      db.exec(quotaSql);
    } catch {
      // May already exist
    }
  }

  // Phase 3+4: growth, feedback, audit
  const miscMigrationPath = resolve("server/migrations/005_growth_feedback.sql");
  const miscSql = existsSync(miscMigrationPath) ? readFileSync(miscMigrationPath, "utf8") : "";
  if (miscSql.trim()) {
    try {
      db.exec(miscSql);
    } catch {
      // May already exist
    }
  }

  const accountMigrationPath = resolve("server/migrations/006_account_email.sql");
  const accountSql = existsSync(accountMigrationPath) ? readFileSync(accountMigrationPath, "utf8") : "";
  if (accountSql.trim()) {
    try {
      db.exec(accountSql);
    } catch {
      // Table/index creation may already exist
    }
  }

  const audioBridgeMigrationPath = resolve("server/migrations/007_audio_bridge.sql");
  const audioBridgeSql = existsSync(audioBridgeMigrationPath) ? readFileSync(audioBridgeMigrationPath, "utf8") : "";
  if (audioBridgeSql.trim()) {
    try {
      db.exec(audioBridgeSql);
    } catch {
      // Table/index creation may already exist
    }
  }

  ensureColumn(db, "users", "email", "alter table users add column email text");
  ensureColumn(db, "users", "email_verified_at", "alter table users add column email_verified_at text");
  ensureColumn(db, "users", "email_verification_token_hash", "alter table users add column email_verification_token_hash text");
  ensureColumn(db, "users", "email_verification_expires_at", "alter table users add column email_verification_expires_at text");
  ensureColumn(db, "users", "password_reset_token_hash", "alter table users add column password_reset_token_hash text");
  ensureColumn(db, "users", "password_reset_expires_at", "alter table users add column password_reset_expires_at text");
  ensureColumn(db, "users", "deleted_at", "alter table users add column deleted_at text");
  ensureColumn(db, "users", "notification_prefs", "alter table users add column notification_prefs text not null default '{}'");

  db.exec("drop index if exists idx_documents_source");
  db.exec("create unique index if not exists idx_documents_owner_source on documents(owner_key, source_type, source_id)");
  db.exec("create unique index if not exists idx_users_email on users(email)");
  db.exec("create index if not exists idx_users_email_verify on users(email_verification_token_hash, email_verification_expires_at)");
  db.exec("create index if not exists idx_users_password_reset on users(password_reset_token_hash, password_reset_expires_at)");

  const columns = db.prepare("pragma table_info(prompt_runs)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "skill_id")) {
    db.exec("alter table prompt_runs add column skill_id text not null default ''");
  }
  ensureColumn(db, "live_cue_sessions", "user_id", "alter table live_cue_sessions add column user_id text");
  db.exec("create index if not exists idx_live_cue_sessions_user on live_cue_sessions(user_id)");
}

function ensureColumn(db: Database.Database, table: string, column: string, statement: string): void {
  const columns = db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((item) => item.name === column)) return;
  db.exec(statement);
}

export function upsertPosition(state: BackendState, position: Position): BackendState {
  const exists = state.positions.some((item) => item.id === position.id);
  return { ...state, positions: exists ? state.positions.map((item) => (item.id === position.id ? position : item)) : [position, ...state.positions] };
}

export function toApiSnapshot(state: BackendState, activePositionId?: string): ApiStateSnapshot {
  return {
    ...state,
    journeyState: state.journeyState ?? "guest",
    activePositionId: state.positions.some((position) => position.id === activePositionId) ? activePositionId! : state.positions[0]?.id ?? "",
  };
}

function normalizeFtsQuery(query: string): string {
  return normalizeSearchTerms(query)
    .slice(0, 32)
    .map((item) => `"${item.replace(/"/g, '""')}"`)
    .join(" OR ");
}

function normalizeSearchTerms(query: string): string[] {
  return Array.from(
    new Set(
      query
        .normalize("NFKC")
        .match(/[\p{Script=Han}]{2,}|[A-Za-z0-9][A-Za-z0-9+#._-]{1,}/gu)
        ?.map((item) => item.replace(/^[-_.+#]+|[-_.+#]+$/g, "").trim())
        .filter((item) => item.length >= 2) ?? [],
    ),
  );
}

function deriveFilePath(dbPath: string): string {
  if (dbPath.endsWith(".json")) return dbPath;
  if (/\.[^.\\/:]+$/.test(dbPath)) return dbPath.replace(/\.[^.\\/:]+$/, ".json");
  return `${dbPath}.json`;
}
