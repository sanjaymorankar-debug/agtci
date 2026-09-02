/**
 * Database schema — AGTCI (Asmi Global Trade Consultancy & International).
 *
 * A B2B sourcing/export site: product catalogue, category grid, lead
 * capture (quote requests + custom sourcing requirements), an admin CMS
 * for products/content/certifications, and per-page SEO fields.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------- admin users */

export const adminRoleEnum = pgEnum("admin_role", ["ADMIN", "STAFF"]);

export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  name: text("name"),
  passwordHash: text("password_hash").notNull(),
  role: adminRoleEnum("role").notNull().default("STAFF"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("admin_users_email_unique").on(t.email)]);

/* ------------------------------------------------------------- categories */

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  /** Short description shown on the category grid card. */
  description: text("description"),
  imageUrl: text("image_url"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("categories_slug_unique").on(t.slug)]);

/* --------------------------------------------------------------- products */

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  categoryId: uuid("category_id").notNull().references(() => categories.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  shortDescription: text("short_description"),
  description: text("description"),
  /** ["url1", "url2", ...] — first image is the primary/card image. */
  images: jsonb("images").$type<string[]>().notNull().default([]),
  origin: text("origin"),
  /** Free-form list, e.g. ["Grade A", "Grade B"]. */
  grades: jsonb("grades").$type<string[]>().notNull().default([]),
  packagingOptions: jsonb("packaging_options").$type<string[]>().notNull().default([]),
  moq: text("moq"),
  supplyCapability: text("supply_capability"),
  exportAvailable: boolean("export_available").notNull().default(true),
  /** Free-form key/value spec sheet: [{label, value}]. */
  specifications: jsonb("specifications").$type<{ label: string; value: string }[]>().notNull().default([]),
  /** Certification slugs that apply to this product — must also be enabled globally. */
  certifications: jsonb("certifications").$type<string[]>().notNull().default([]),
  isFeatured: boolean("is_featured").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),

  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  seoKeywords: text("seo_keywords"),
  ogImageUrl: text("og_image_url"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("products_slug_unique").on(t.slug),
  index("products_category_idx").on(t.categoryId),
  index("products_featured_idx").on(t.isFeatured),
  index("products_active_idx").on(t.isActive),
]);

/* ------------------------------------------------------------------ leads */

export const leadStatusEnum = pgEnum("lead_status", [
  "NEW",
  "CONTACTED",
  "REQUIREMENT_CONFIRMED",
  "QUOTATION_SENT",
  "NEGOTIATION",
  "ORDER_RECEIVED",
  "COMPLETED",
  "LOST",
]);

export const leadSourceEnum = pgEnum("lead_source", [
  "PRODUCT_QUOTE",
  "GENERAL_QUOTE",
  "CUSTOM_SOURCING",
  "CONTACT_FORM",
]);

export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: leadSourceEnum("source").notNull(),
  status: leadStatusEnum("status").notNull().default("NEW"),

  fullName: text("full_name").notNull(),
  companyName: text("company_name"),
  country: text("country"),
  email: text("email").notNull(),
  phone: text("phone"),

  productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
  /** Snapshot so a lead stays readable even if the product is later renamed/removed. */
  productNameSnapshot: text("product_name_snapshot"),

  quantity: text("quantity"),
  specification: text("specification"),
  qualityRequirement: text("quality_requirement"),
  packaging: text("packaging"),
  destinationCountry: text("destination_country"),
  targetPrice: text("target_price"),
  deliveryTimeline: text("delivery_timeline"),
  additionalInfo: text("additional_info"),
  /** ["url1", ...] — uploaded reference files/specs. */
  attachments: jsonb("attachments").$type<string[]>().notNull().default([]),

  assignedTo: uuid("assigned_to").references(() => adminUsers.id, { onDelete: "set null" }),
  notes: text("notes"),
  followUpDate: timestamp("follow_up_date", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("leads_status_idx").on(t.status),
  index("leads_source_idx").on(t.source),
  index("leads_created_idx").on(t.createdAt),
]);

/* ------------------------------------------------------------ certifications */

/**
 * Admin-toggleable — a certification is never shown on the public site
 * unless explicitly enabled here, per the brief's "never invent/never
 * display an unheld certification" rule.
 */
export const certifications = pgTable("certifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [uniqueIndex("certifications_slug_unique").on(t.slug)]);

/* --------------------------------------------------------------- services */

export const services = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  icon: text("icon"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [uniqueIndex("services_slug_unique").on(t.slug)]);

/* ------------------------------------------------------------ site content */

/**
 * Free-form editable content blocks (About text, Why-AGTCI cards, contact
 * details, WhatsApp number, social links, ...), keyed so the admin panel
 * can edit each block without a schema change per field.
 */
export const siteContent = pgTable("site_content", {
  key: text("key").primaryKey(),
  /** Arbitrary JSON payload — shape depends on the key (see site-content.ts). */
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------- audit log */

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").references(() => adminUsers.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  previousValue: jsonb("previous_value"),
  newValue: jsonb("new_value"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_logs_entity_idx").on(t.entityType, t.entityId)]);

/* ------------------------------------------------------------------ types */

export type AdminUser = typeof adminUsers.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type LeadStatus = (typeof leadStatusEnum.enumValues)[number];
export type LeadSource = (typeof leadSourceEnum.enumValues)[number];
export type Certification = typeof certifications.$inferSelect;
export type Service = typeof services.$inferSelect;
export type SiteContentRow = typeof siteContent.$inferSelect;
