import { describe, expect, it } from 'vitest';
import { History } from '../src/model/history';

describe('History', () => {
  it('keeps the last 5 changes', () => {
    const h = new History(5);
    for (let i = 0; i <= 7; i++) h.commit(String(i));
    expect(h.size).toBe(5);
    expect([h.undo(), h.undo(), h.undo(), h.undo(), h.undo(), h.undo()]).toEqual(['6', '5', '4', '3', '2', null]);
  });
  it('does not record unchanged states', () => {
    const h = new History();
    h.commit('a'); h.commit('a'); h.commit('a');
    expect(h.size).toBe(0);
  });
  it('a new change after undo continues from the restored state', () => {
    const h = new History();
    h.commit('a'); h.commit('b'); expect(h.undo()).toBe('a');
    h.commit('c'); expect(h.undo()).toBe('a');
  });
});
