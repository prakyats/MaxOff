/**
 * modules/templates: the public API (ARCHITECTURE §3.1, §3.2: it owns `project_templates`; task
 * templates live in `modules/tasks` since 4.6). Project templates (7.4; kickoff 7 decision 23).
 *
 * Client components are not exported here: a route imports them one file at a time from
 * `components/` (ADR-0011 amendment).
 */
export { listProjectTemplates } from "./data/project-templates";
export {
  linesOf,
  projectTemplateActions,
  type ProjectTemplate,
  type TemplateRecurrence,
} from "./domain/project-templates";
