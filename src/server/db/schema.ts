/**
 * Database schema — AGTCI (Asmi Global Trade Consultancy & International).
 *
 * A B2B sourcing/export site: product catalogue, category grid, lead
 * capture (quote requests + custom sourcing requirements), an admin CMS
 * for products/content/certifications, and per-page SEO fields.
 *
 * MySQL (Hostinger-hosted) — IDs are app-generated UUID strings (varchar),
 * since MySQL has no native UUID type/default the way Postgres does.
 */
import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

const uuidPk = () =>
  varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

/* ------------------------------------------------------------- admin users */

export const adminUsers = mysqlTable("admin_users", {
  id: uuidPk(),
  email: varchar("email", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: mysqlEnum("role", ["ADMIN", "STAFF"]).notNull().default("STAFF"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("admin_users_email_unique").on(t.email)]);

/* ------------------------------------------------------------- categories */

export const categories = mysqlTable("categories", {
  id: uuidPk(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull(),
  description: text("description"),
  imageUrl: varchar("image_url", { length: 1000 }),
  sortOrder: int("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => [uniqueIndex("categories_slug_unique").on(t.slug)]);

/* --------------------------------------------------------------- products */

export const products = mysqlTable("products", {
  id: uuidPk(),
  categoryId: varchar("category_id", { length: 36 }).notNull().references(() => categories.id, { onDelete: "restrict" }),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull(),
  shortDescription: text("short_description"),
  description: text("description"),
  /** ["url1", "url2", ...] — first image is the primary/card image. */
  images: json("images").$type<string[]>().notNull().default([]),
  origin: varchar("origin", { length: 255 }),
  grades: json("grades").$type<string[]>().notNull().default([]),
  packagingOptions: json("packaging_options").$type<string[]>().notNull().default([]),
  moq: varchar("moq", { length: 255 }),
  supplyCapability: text("supply_capability"),
  exportAvailable: boolean("export_available").notNull().default(true),
  /** Free-form key/value spec sheet: [{label, value}]. */
  specifications: json("specifications").$type<{ label: string; value: string }[]>().notNull().default([]),
  /** Certification slugs that apply to this product — must also be enabled globally. */
  certifications: json("certifications").$type<string[]>().notNull().default([]),
  isFeatured: boolean("is_featured").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: int("sort_order").notNull().default(0),

  seoTitle: varchar("seo_title", { length: 255 }),
  seoDescription: varchar("seo_description", { length: 500 }),
  seoKeywords: varchar("seo_keywords", { length: 500 }),
  ogImageUrl: varchar("og_image_url", { length: 1000 }),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
}, (t) => [
  uniqueIndex("products_slug_unique").on(t.slug),
  index("products_category_idx").on(t.categoryId),
  index("products_featured_idx").on(t.isFeatured),
  index("products_active_idx").on(t.isActive),
]);

/* ------------------------------------------------------------------ leads */

export const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "REQUIREMENT_CONFIRMED",
  "QUOTATION_SENT",
  "NEGOTIATION",
  "ORDER_RECEIVED",
  "COMPLETED",
  "LOST",
] as const;

export const LEAD_SOURCES = [
  "PRODUCT_QUOTE",
  "GENERAL_QUOTE",
  "CUSTOM_SOURCING",
  "CONTACT_FORM",
] as const;

export const leads = mysqlTable("leads", {
  id: uuidPk(),
  source: mysqlEnum("source", LEAD_SOURCES).notNull(),
  status: mysqlEnum("status", LEAD_STATUSES).notNull().default("NEW"),

  fullName: varchar("full_name", { length: 255 }).notNull(),
  companyName: varchar("company_name", { length: 255 }),
  country: varchar("country", { length: 100 }),
  email: varchar("email", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }),

  productId: varchar("product_id", { length: 36 }).references(() => products.id, { onDelete: "set null" }),
  /** Snapshot so a lead stays readable even if the product is later renamed/removed. */
  productNameSnapshot: varchar("product_name_snapshot", { length: 255 }),

  quantity: varchar("quantity", { length: 255 }),
  specification: text("specification"),
  qualityRequirement: text("quality_requirement"),
  packaging: varchar("packaging", { length: 255 }),
  destinationCountry: varchar("destination_country", { length: 100 }),
  targetPrice: varchar("target_price", { length: 255 }),
  deliveryTimeline: varchar("delivery_timeline", { length: 255 }),
  additionalInfo: text("additional_info"),
  /** ["url1", ...] — uploaded reference files/specs. */
  attachments: json("attachments").$type<string[]>().notNull().default([]),

  assignedTo: varchar("assigned_to", { length: 36 }).references(() => adminUsers.id, { onDelete: "set null" }),
  notes: text("notes"),
  followUpDate: timestamp("follow_up_date"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
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
export const certifications = mysqlTable("certifications", {
  id: uuidPk(),
  slug: varchar("slug", { length: 100 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  sortOrder: int("sort_order").notNull().default(0),
}, (t) => [uniqueIndex("certifications_slug_unique").on(t.slug)]);

/* --------------------------------------------------------------- services */

export const services = mysqlTable("services", {
  id: uuidPk(),
  title: varchar("title", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull(),
  description: text("description"),
  icon: varchar("icon", { length: 100 }),
  sortOrder: int("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [uniqueIndex("services_slug_unique").on(t.slug)]);

/* ------------------------------------------------------------ site content */

/**
 * Free-form editable content blocks (About text, Why-AGTCI cards, contact
 * details, WhatsApp number, social links, ...), keyed so the admin panel
 * can edit each block without a schema change per field.
 */
export const siteContent = mysqlTable("site_content", {
  key: varchar("key", { length: 100 }).primaryKey(),
  /** Arbitrary JSON payload — shape depends on the key (see site-content.ts). */
  value: json("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

/* ------------------------------------------------------------- audit log */

export const auditLogs = mysqlTable("audit_logs", {
  id: uuidPk(),
  actorId: varchar("actor_id", { length: 36 }).references(() => adminUsers.id),
  action: varchar("action", { length: 255 }).notNull(),
  entityType: varchar("entity_type", { length: 100 }).notNull(),
  entityId: varchar("entity_id", { length: 255 }),
  previousValue: json("previous_value"),
  newValue: json("new_value"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("audit_logs_entity_idx").on(t.entityType, t.entityId)]);

/* ------------------------------------------------------------------ types */

export type AdminUser = typeof adminUsers.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type LeadSource = (typeof LEAD_SOURCES)[number];
export type Certification = typeof certifications.$inferSelect;
export type Service = typeof services.$inferSelect;
export type SiteContentRow = typeof siteContent.$inferSelect;
