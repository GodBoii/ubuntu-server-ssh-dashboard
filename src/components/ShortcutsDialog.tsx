import { X } from "lucide-react";
import { useOverlay } from "../hooks/useOverlay";
import { Act } from "./kit";

export type ShortcutGroup = { name: string; items: Array<{ keys: string[]; description: string }> };

export function ShortcutsDialog({ groups, onClose }: { groups: ShortcutGroup[]; onClose: () => void }) {
  const { containerRef, open, requestClose } = useOverlay({ onClose });

  return (
    <div
      className="veil centre"
      data-open={open}
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
    >
      <div className="sheet-surface keys" data-open={open} role="dialog" aria-modal="true" aria-labelledby="keys-title" ref={containerRef}>
        <header className="sheet-head">
          <h2 id="keys-title">keyboard</h2>
          <Act label="Close" icon={<X size={14} />} onClick={requestClose} />
        </header>
        <div className="keys-body">
          {groups.map((group) => (
            <section key={group.name}>
              <h3>{group.name}</h3>
              <dl>
                {group.items.map((item) => (
                  <div key={item.description}>
                    <dt>{item.keys.map((key) => <kbd key={key}>{key}</kbd>)}</dt>
                    <dd>{item.description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
