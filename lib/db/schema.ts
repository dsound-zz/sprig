import {
  pgTable,
  uuid,
  text,
  timestamp,
  real,
  integer,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").unique().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const magicTokens = pgTable("magic_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  token: text("token").unique().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const maps = pgTable("maps", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const nodes = pgTable("nodes", {
  id: uuid("id").primaryKey().defaultRandom(),
  mapId: uuid("map_id")
    .notNull()
    .references(() => maps.id, { onDelete: "cascade" }),
  // Self-referential FK must use a lambda to avoid circular reference at parse time
  parentId: uuid("parent_id").references((): AnyPgColumn => nodes.id, {
    onDelete: "set null",
  }),
  label: text("label").notNull(),
  fullConcept: text("full_concept").notNull().default(""),
  positionX: real("position_x").notNull().default(0),
  positionY: real("position_y").notNull().default(0),
  depth: integer("depth").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const edges = pgTable("edges", {
  id: uuid("id").primaryKey().defaultRandom(),
  mapId: uuid("map_id")
    .notNull()
    .references(() => maps.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  targetId: uuid("target_id")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  edgeType: text("edge_type").notNull().default("tree"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Relations

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  maps: many(maps),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const mapsRelations = relations(maps, ({ one, many }) => ({
  user: one(users, { fields: [maps.userId], references: [users.id] }),
  nodes: many(nodes),
  edges: many(edges),
}));

export const nodesRelations = relations(nodes, ({ one, many }) => ({
  map: one(maps, { fields: [nodes.mapId], references: [maps.id] }),
  parent: one(nodes, { fields: [nodes.parentId], references: [nodes.id] }),
  children: many(nodes),
}));

export const edgesRelations = relations(edges, ({ one }) => ({
  map: one(maps, { fields: [edges.mapId], references: [maps.id] }),
  source: one(nodes, { fields: [edges.sourceId], references: [nodes.id] }),
  target: one(nodes, { fields: [edges.targetId], references: [nodes.id] }),
}));

// Inferred types

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type MagicToken = typeof magicTokens.$inferSelect;
export type NewMagicToken = typeof magicTokens.$inferInsert;

export type Map = typeof maps.$inferSelect;
export type NewMap = typeof maps.$inferInsert;

export type Node = typeof nodes.$inferSelect;
export type NewNode = typeof nodes.$inferInsert;

export type Edge = typeof edges.$inferSelect;
export type NewEdge = typeof edges.$inferInsert;
