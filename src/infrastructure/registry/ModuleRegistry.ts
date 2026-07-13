import type { IAuditModule, IModuleRegistry } from '@core/domain/ports';

// Audit module registry. New modules (Keyboard, Zoom, Contrast, ARIA, NVDA)
// and external plugins are added here without changing the orchestrator.
export class ModuleRegistry implements IModuleRegistry {
  private readonly modules: IAuditModule[];

  constructor(modules: IAuditModule[]) {
    this.modules = modules;
  }

  all(): IAuditModule[] {
    return [...this.modules];
  }

  // Returns modules with the given ids (preserving registration order), or all of them.
  resolve(ids?: string[]): IAuditModule[] {
    if (!ids || ids.length === 0) return this.all();
    const set = new Set(ids);
    return this.modules.filter((m) => set.has(m.id));
  }
}
