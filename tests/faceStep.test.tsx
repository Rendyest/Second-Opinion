import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FaceReachStep } from '../src/components/FaceReachStep';

const BANNED = /\b(fps|frames?|calls?|saved|flag rate|latency|escalat\w*)\b/i;

describe('face reach step', () => {
  it('renders the instruction, preview hook, and actions with no banned words', () => {
    const html = renderToStaticMarkup(<FaceReachStep />);
    // Check visible text: tags such as h2 necessarily contain digits.
    const text = html.replace(/<[^>]+>/g, ' ');
    expect(html).toContain('Face Calibration');
    expect(html).toContain('Sit facing the camera');
    expect(html).toContain('Start face step');
    expect(html).toContain('Continue without face step');
    expect(html).toContain('Face step camera preview');
    expect(html).not.toMatch(BANNED);
    expect(text).not.toMatch(BANNED);
    expect(text).not.toMatch(/\d/);
  });
});
