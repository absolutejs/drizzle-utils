import {
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	timestamp,
	varchar,
	foreignKey
} from "drizzle-orm/pg-core";
import { MEMBER_ROLES } from "./constants";
import type { Profile } from "./types";

export const memberRoleEnum = pgEnum("member_roles", MEMBER_ROLES);

export const employees = pgTable("employees", {
	created_at: timestamp("created_at").notNull().defaultNow(),
	email: varchar("email", { length: 255 }).notNull(),
	id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
	profile: jsonb("profile").$type<Profile>()
});

export const projects = pgTable("projects", {
	created_at: timestamp("created_at").notNull().defaultNow(),
	id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
	name: varchar("name", { length: 255 }).notNull()
});

export const assignments = pgTable(
	"assignments",
	{
		effort_points: integer("effort_points").notNull().default(0),
		employee_id: integer("employee_id")
			.references(() => employees.id)
			.notNull(),
		project_id: integer("project_id")
			.references(() => projects.id)
			.notNull(),
		role: memberRoleEnum("role").notNull()
	},
	(table) => [
		primaryKey({ columns: [table.employee_id, table.project_id] }),
		foreignKey({
			columns: [table.employee_id, table.project_id],
			foreignColumns: [employees.id, projects.id]
		})
	]
);

export const schema = {
	assignments,
	employees,
	projects
} as const;
