import { ModuleRegistry } from '@infra/registry/ModuleRegistry';
import { WcagScanModule } from '@infra/modules/WcagScanModule';
import { KeyboardNavigationModule } from '@infra/modules/KeyboardNavigationModule';
import { ZoomReflowModule } from '@infra/modules/ZoomReflowModule';
import { ContrastModule } from '@infra/modules/ContrastModule';
import { AriaModule } from '@infra/modules/AriaModule';
import { NvdaModule } from '@infra/modules/NvdaModule';
import { DynamicContentModule } from '@infra/modules/DynamicContentModule';

// Single source of truth for the set of audit modules. Used both by the process
// the Electron main process (composition) and by the CLI, to keep the lists in sync.
export function createDefaultRegistry(): ModuleRegistry {
  return new ModuleRegistry([
    new WcagScanModule(),
    new KeyboardNavigationModule(),
    new ZoomReflowModule(),
    new ContrastModule(),
    new AriaModule(),
    new NvdaModule(),
    new DynamicContentModule()
  ]);
}
