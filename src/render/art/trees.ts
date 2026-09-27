/**
 * Tree sprites (top-down, lit from the north-west) cached per resolution,
 * kind, colour and snow. Drawn into terrain chunks.
 */
import { shade } from '../util/color';
import { cachedSprite, type Sprite } from '../util/sprites';

export type TreeKind = 'round' | 'cone' | 'palm' | 'bare' | 'bush' | 'cactus';

/** Sprite covers TREE_SPAN tiles (square), tree centred. */
export const TREE_SPAN = 0.7;

export function treeSprite(ppt: number, kind: TreeKind, color: string, snow: boolean): Sprite {
  const px = Math.max(4, Math.ceil(ppt * TREE_SPAN));
  return cachedSprite(`tree|${px}|${kind}|${color}|${snow ? 1 : 0}`, px, px, (g, w) => {
    const c = w / 2;
    const r = w * 0.36;
    g.translate(c, c);
    // ground shadow (SE)
    g.fillStyle = 'rgba(18,36,22,0.28)';
    g.beginPath();
    g.ellipse(r * 0.28, r * 0.34, r * 0.95, r * 0.85, 0, 0, Math.PI * 2);
    g.fill();
    switch (kind) {
      case 'round':
      case 'bush': {
        const rr = kind === 'bush' ? r * 0.7 : r;
        g.fillStyle = shade(color, 0.72);
        g.beginPath();
        g.arc(0, 0, rr, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = color;
        g.beginPath();
        g.arc(-rr * 0.1, -rr * 0.1, rr * 0.84, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = shade(color, 1.22);
        g.beginPath();
        g.arc(-rr * 0.32, -rr * 0.32, rr * 0.42, 0, Math.PI * 2);
        g.fill();
        if (snow) {
          g.fillStyle = 'rgba(245,249,252,0.85)';
          g.beginPath();
          g.arc(-rr * 0.25, -rr * 0.3, rr * 0.5, 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
      case 'cone': {
        const star = (rad: number, inner: number, rot: number): void => {
          g.beginPath();
          const n = 9;
          for (let i = 0; i < n * 2; i++) {
            const a = rot + (i * Math.PI) / n;
            const rr = i % 2 === 0 ? rad : rad * inner;
            if (i === 0) g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
            else g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          g.closePath();
          g.fill();
        };
        g.fillStyle = shade(color, 0.7);
        star(r, 0.72, 0);
        g.fillStyle = color;
        star(r * 0.72, 0.7, 0.35);
        g.fillStyle = shade(color, 1.25);
        star(r * 0.38, 0.65, 0.1);
        if (snow) {
          g.fillStyle = 'rgba(246,250,252,0.9)';
          star(r * 0.5, 0.55, 0.2);
        }
        break;
      }
      case 'palm': {
        g.strokeStyle = color;
        g.lineCap = 'round';
        g.lineWidth = r * 0.34;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + 0.3;
          g.beginPath();
          g.moveTo(0, 0);
          g.quadraticCurveTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6 - r * 0.15, Math.cos(a) * r, Math.sin(a) * r);
          g.stroke();
        }
        g.fillStyle = '#8a6a3a';
        g.beginPath();
        g.arc(0, 0, r * 0.18, 0, Math.PI * 2);
        g.fill();
        break;
      }
      case 'bare': {
        g.strokeStyle = '#7c6a58';
        g.lineCap = 'round';
        g.lineWidth = Math.max(0.8, r * 0.12);
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          g.beginPath();
          g.moveTo(0, 0);
          g.lineTo(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85);
          g.stroke();
        }
        g.fillStyle = snow ? 'rgba(240,245,248,0.8)' : 'rgba(140,120,100,0.35)';
        g.beginPath();
        g.arc(0, 0, r * 0.55, 0, Math.PI * 2);
        g.fill();
        break;
      }
      case 'cactus': {
        g.fillStyle = '#5f8f4a';
        g.beginPath();
        g.arc(0, 0, r * 0.35, 0, Math.PI * 2);
        g.fill();
        g.fillRect(-r * 0.7, -r * 0.12, r * 1.4, r * 0.24);
        g.fillStyle = '#7fae5c';
        g.beginPath();
        g.arc(-r * 0.08, -r * 0.08, r * 0.18, 0, Math.PI * 2);
        g.fill();
        break;
      }
    }
  });
}
