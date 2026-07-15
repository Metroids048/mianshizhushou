import { PERSONAS, type PersonaKey } from "./sharedConfig";

export function PersonaSelector({
  selected,
  onSelect,
}: {
  selected: PersonaKey;
  onSelect: (key: PersonaKey) => void;
}) {
  return (
    <div className="persona-selector">
      {PERSONAS.map((persona) => (
        <button
          key={persona.id}
          type="button"
          className={`persona-card${selected === persona.id ? " active" : ""}`}
          onClick={() => onSelect(persona.id)}
        >
          <span className="persona-avatar">{persona.avatar}</span>
          <div>
            <strong>{persona.label}</strong>
            <p>{persona.description}</p>
          </div>
        </button>
      ))}
    </div>
  );
}
