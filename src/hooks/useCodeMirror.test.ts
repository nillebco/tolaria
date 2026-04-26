import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { RUNTIME_STYLE_NONCE } from '../lib/runtimeStyleNonce'
import { useCodeMirror, toggleTodoLine, type CodeMirrorCallbacks } from './useCodeMirror'

const noop = () => {}
const noopCallbacks: CodeMirrorCallbacks = {
  onDocChange: noop,
  onCursorActivity: noop,
  onSave: noop,
  onEscape: () => false,
}

describe('useCodeMirror', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  it('creates an EditorView in the container', () => {
    const ref = { current: container }
    const { result } = renderHook(() =>
      useCodeMirror(ref, 'hello world', noopCallbacks),
    )
    expect(result.current.current).not.toBeNull()
    expect(container.querySelector('.cm-editor')).toBeInTheDocument()
  })

  it('tags generated CodeMirror style elements with the runtime CSP nonce', () => {
    const ref = { current: container }
    const { result } = renderHook(() =>
      useCodeMirror(ref, 'hello world', noopCallbacks),
    )

    expect(result.current.current?.state.facet(EditorView.cspNonce)).toBe(RUNTIME_STYLE_NONCE)
  })

  it('enables per-line auto text direction for mixed LTR and RTL content', () => {
    const ref = { current: container }
    const { result } = renderHook(() =>
      useCodeMirror(ref, 'English\nمرحبا بالعالم', noopCallbacks),
    )
    const view = result.current.current!

    expect(view.state.facet(EditorView.perLineTextDirection)).toBe(true)
    expect([...container.querySelectorAll('.cm-line')].map(line => line.getAttribute('dir'))).toEqual(['auto', 'auto'])
  })

  it('calls requestMeasure when laputa-zoom-change event fires', () => {
    const ref = { current: container }
    const { result } = renderHook(() =>
      useCodeMirror(ref, 'hello', noopCallbacks),
    )
    const view = result.current.current!
    const spy = vi.spyOn(view, 'requestMeasure')

    act(() => {
      window.dispatchEvent(new Event('laputa-zoom-change'))
    })

    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('stops listening for zoom changes after unmount', () => {
    const ref = { current: container }
    const { result, unmount } = renderHook(() =>
      useCodeMirror(ref, 'hello', noopCallbacks),
    )
    const view = result.current.current!
    const spy = vi.spyOn(view, 'requestMeasure')

    unmount()

    act(() => {
      window.dispatchEvent(new Event('laputa-zoom-change'))
    })

    // After unmount, the listener should be removed — requestMeasure should NOT be called.
    // (The view is also destroyed on unmount, so this verifies cleanup.)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('syncs content prop changes to the editor', () => {
    const ref = { current: container }
    const onDocChange = vi.fn()
    const callbacks = { ...noopCallbacks, onDocChange }
    const { result, rerender } = renderHook(
      ({ content }) => useCodeMirror(ref, content, callbacks),
      { initialProps: { content: '---\ntitle: Hello\n---\nBody' } },
    )
    const view = result.current.current!
    expect(view.state.doc.toString()).toBe('---\ntitle: Hello\n---\nBody')

    // Simulate external content update (e.g. frontmatter written to disk)
    rerender({ content: '---\ntitle: Hello\nTrashed: true\n---\nBody' })

    expect(view.state.doc.toString()).toBe('---\ntitle: Hello\nTrashed: true\n---\nBody')
    // External sync should NOT trigger onDocChange (would cause infinite loop)
    expect(onDocChange).not.toHaveBeenCalled()
  })

  it('lets app Escape handling run before the CodeMirror default keymap', () => {
    const ref = { current: container }
    const onEscape = vi.fn(() => true)
    const { result } = renderHook(() =>
      useCodeMirror(ref, 'hello', { ...noopCallbacks, onEscape }),
    )
    const view = result.current.current!

    act(() => {
      view.focus()
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Escape',
      }))
    })

    expect(onEscape).toHaveBeenCalledOnce()
  })

  it('does not sync when content matches current editor state', () => {
    const ref = { current: container }
    const { result, rerender } = renderHook(
      ({ content }) => useCodeMirror(ref, content, noopCallbacks),
      { initialProps: { content: 'hello' } },
    )
    const view = result.current.current!
    const spy = vi.spyOn(view, 'dispatch')

    // Re-render with same content — no dispatch needed
    rerender({ content: 'hello' })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('installs zoomCursorFix that overrides posAtCoords on the view instance', () => {
    const ref = { current: container }
    const { result } = renderHook(() =>
      useCodeMirror(ref, 'hello world', noopCallbacks),
    )
    const view = result.current.current!
    // The extension overrides posAtCoords on the instance (not the prototype)
    expect(Object.prototype.hasOwnProperty.call(view, 'posAtCoords')).toBe(true)
  })
})

function makeView(text: string, cursorPos = 0) {
  const state = EditorState.create({ doc: text, selection: { anchor: cursorPos } })
  return new EditorView({ state })
}

describe('toggleTodoLine', () => {
  it('prepends "- [ ] " to a plain line', () => {
    const view = makeView('buy milk')
    toggleTodoLine(view)
    expect(view.state.doc.toString()).toBe('- [ ] buy milk')
  })

  it('checks an unchecked todo line', () => {
    const view = makeView('- [ ] buy milk')
    toggleTodoLine(view)
    expect(view.state.doc.toString()).toBe('- [x] buy milk')
  })

  it('removes the todo prefix from a checked todo line', () => {
    const view = makeView('- [x] buy milk')
    toggleTodoLine(view)
    expect(view.state.doc.toString()).toBe('buy milk')
  })

  it('operates on the line under the cursor, not line 1', () => {
    const text = 'first line\nsecond line'
    const view = makeView(text, text.indexOf('second'))
    toggleTodoLine(view)
    expect(view.state.doc.toString()).toBe('first line\n- [ ] second line')
  })

  it('works on an empty line', () => {
    const view = makeView('')
    toggleTodoLine(view)
    expect(view.state.doc.toString()).toBe('- [ ] ')
  })
})
