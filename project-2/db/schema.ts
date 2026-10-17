import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const employeeSessions = sqliteTable('employee_sessions', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  employeeId: text('employee_id').notNull(),
  secret: text('secret').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('employee_sessions_expiry').on(table.expiresAt)]);

export const loginAttempts = sqliteTable('login_attempts', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('login_attempts_expiry').on(table.expiresAt)]);
