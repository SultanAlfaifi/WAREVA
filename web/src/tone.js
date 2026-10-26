// The colour family of a decision: verify (irrigating), hold, danger (critical reason) or idle.
// Kept apart from the 3D code so the page works even where 3D cannot load.
import rules from '../../core/rules.json';

export function tone(snapshot) {
  const d = snapshot.decision;
  if (d.state === 'REUSE') return 'verify';
  if (d.state === 'HOLD') return d.reasons.some(r => rules.reasons[r.code].severity === 'critical') ? 'danger' : 'hold';
  return 'idle';
}

// Phones and small tablets get the light renderer: no post-processing, shadows or glass refraction.
export const LOW_POWER = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700;
