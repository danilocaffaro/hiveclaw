import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { CURATED_SKILLS } from '../engine/skill-hub.js';

export interface MarketplaceSkill {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  category: string;
  tags: string[];
  downloads: number;
  rating: number;
  ratingCount: number;
  icon: string;
  installCommand: string | null;
  configSchema: Record<string, unknown>;
  installed: boolean;
  installedAt: string | null;
  createdAt: string;
}

interface RawRow {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  category: string;
  tags: string;
  downloads: number;
  rating: number;
  rating_count: number;
  icon: string;
  install_command: string | null;
  config_schema: string;
  installed: number;
  installed_at: string | null;
  created_at: string;
}

// SEED_SKILLS removed — marketplace is populated via ClawHub or user installs


function toSkill(row: RawRow): MarketplaceSkill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    author: row.author,
    version: row.version,
    category: row.category,
    tags: JSON.parse(row.tags || '[]') as string[],
    downloads: row.downloads,
    rating: row.rating,
    ratingCount: row.rating_count,
    icon: row.icon,
    installCommand: row.install_command,
    configSchema: JSON.parse(row.config_schema || '{}') as Record<string, unknown>,
    installed: row.installed === 1,
    installedAt: row.installed_at,
    createdAt: row.created_at,
  };
}

export class MarketplaceRepository {
  constructor(private db: Database.Database) {}

  list(filters?: { category?: string; installed?: boolean; search?: string }): MarketplaceSkill[] {
    let query = 'SELECT * FROM marketplace_skills WHERE 1=1';
    const params: (string | number)[] = [];

    if (filters?.category) {
      query += ' AND category = ?';
      params.push(filters.category);
    }
    if (filters?.installed !== undefined) {
      query += ' AND installed = ?';
      params.push(filters.installed ? 1 : 0);
    }
    if (filters?.search) {
      query += ' AND (name LIKE ? OR description LIKE ? OR tags LIKE ?)';
      const term = `%${filters.search}%`;
      params.push(term, term, term);
    }

    query += ' ORDER BY downloads DESC, name ASC';
    const rows = this.db.prepare(query).all(...params) as RawRow[];
    return rows.map(toSkill);
  }

  getById(id: string): MarketplaceSkill | undefined {
    const row = this.db
      .prepare('SELECT * FROM marketplace_skills WHERE id = ?')
      .get(id) as RawRow | undefined;
    return row ? toSkill(row) : undefined;
  }

  install(id: string): MarketplaceSkill {
    const skill = this.getById(id);
    if (!skill) throw new Error(`Skill '${id}' not found`);

    this.db
      .prepare(
        'UPDATE marketplace_skills SET installed = 1, installed_at = datetime(\'now\'), downloads = downloads + 1 WHERE id = ?',
      )
      .run(id);

    return this.getById(id)!;
  }

  uninstall(id: string): MarketplaceSkill {
    const skill = this.getById(id);
    if (!skill) throw new Error(`Skill '${id}' not found`);

    this.db
      .prepare('UPDATE marketplace_skills SET installed = 0, installed_at = NULL WHERE id = ?')
      .run(id);

    return this.getById(id)!;
  }

  rate(id: string, rating: number): MarketplaceSkill {
    const skill = this.getById(id);
    if (!skill) throw new Error(`Skill '${id}' not found`);
    if (rating < 1 || rating > 5) throw new Error('Rating must be between 1 and 5');

    // Incremental average: new_avg = (old_avg * count + new_rating) / (count + 1)
    this.db
      .prepare(
        `UPDATE marketplace_skills
         SET rating = (rating * rating_count + ?) / (rating_count + 1),
             rating_count = rating_count + 1
         WHERE id = ?`,
      )
      .run(rating, id);

    return this.getById(id)!;
  }

  seed(): void {
    // Seed from curated skill hub (Batch 7.5) — only insert if not already present
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO marketplace_skills
        (id, name, description, author, version, category, tags, downloads, rating, rating_count, icon, install_command, config_schema, installed, installed_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const skill of CURATED_SKILLS) {
      insert.run(
        skill.slug,            // Use slug as ID for curated skills (deterministic)
        skill.name,
        skill.description,
        skill.author,
        skill.version,
        skill.category,
        JSON.stringify(skill.tags),
        skill.usageCount,
        skill.securityScore,   // Reuse securityScore as rating
        1,
        '⭐',                  // Default icon
        null,                  // No install command needed (content bundled)
        JSON.stringify({}),
        0,                     // Not auto-installed
        null,
        new Date().toISOString(),
      );
    }
  }
}
