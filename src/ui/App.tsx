/* artifact 版の DOM 構造(ID・クラス維持)を JSX で再現し、
   controller の snapshot を購読して描画する。specs/06-ui-state.md が正。 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import * as C from "./controller";

function useSnapshot(): C.Snapshot {
  return useSyncExternalStore(C.subscribe, C.getSnapshot);
}

function ZReadout() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => C.subscribeZ(z => {
    if (ref.current) ref.current.textContent = z.toFixed(2);
  }), []);
  return <span className="val mono" id="zVal" ref={ref}></span>;
}

function JumpPanel({ open, prefill, msg }: { open: boolean; prefill: string; msg: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [open, prefill]);
  return (
    <div className={"panel" + (open ? " open" : "")} id="jumpPanel">
      <span className="label">jump</span>
      <input type="text" id="jumpInput" autoComplete="off" autoCapitalize="off" spellCheck={false}
        key={open ? prefill : ""} defaultValue={prefill} ref={inputRef}
        onKeyDown={e => { if (e.key === "Enter") C.doJump(e.currentTarget.value); }} />
      <div className="panelRow">
        <span className="panelMsg" id="jumpMsg">{msg}</span>
        <button className="btn sym" id="jumpCancel" title="Cancel" aria-label="Cancel"
          onClick={C.closePanels}>✕</button>
        <button className="btn sym" id="jumpGo" title="Go" aria-label="Go"
          onClick={() => C.doJump(inputRef.current ? inputRef.current.value : "")}>↵</button>
      </div>
    </div>
  );
}

function NotebookPanel({ open, bookmarks }: { open: boolean; bookmarks: C.Bookmark[] }) {
  return (
    <div className={"panel" + (open ? " open" : "")} id="nbPanel">
      <span className="label">notebook</span>
      <div id="nbList">
        {bookmarks.map(b => (
          <div className="nbRow" key={b.a} onClick={() => C.gotoBookmark(b.a)}>
            <div className="nbChip" style={{ color: b.colorCss, background: b.colorCss }}></div>
            <span className="nbCode">{b.code}</span>
            <span className="nbKind">{b.kind}</span>
            <button className="nbDel"
              onClick={e => { e.stopPropagation(); C.removeBookmark(b.a); }}>×</button>
          </div>
        ))}
      </div>
      <div id="nbEmpty" style={{ display: bookmarks.length ? "none" : "block" }}>
        nothing written down yet
      </div>
      <div className="panelRow">
        <button className="btn sym" id="nbCopyAll" title="Copy all" aria-label="Copy all"
          onClick={C.copyAllBookmarks}>⧉</button>
        <button className="btn sym" id="nbPaste" title="Paste" aria-label="Paste"
          onClick={C.openPaste}>＋</button>
        <button className="btn sym" id="nbClose" title="Close" aria-label="Close"
          onClick={C.closePanels}>✕</button>
      </div>
    </div>
  );
}

function PastePanel({ open, msg }: { open: boolean; msg: string }) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (open && areaRef.current) {
      areaRef.current.value = "";
      areaRef.current.focus();
    }
  }, [open]);
  return (
    <div className={"panel" + (open ? " open" : "")} id="pastePanel">
      <span className="label">paste · one per line</span>
      <textarea id="pasteArea" autoCapitalize="off" spellCheck={false} ref={areaRef}></textarea>
      <div className="panelRow">
        <span className="panelMsg" id="pasteMsg">{msg}</span>
        <button className="btn sym" id="pasteCancel" title="Cancel" aria-label="Cancel"
          onClick={C.cancelPaste}>✕</button>
        <button className="btn sym" id="pasteImport" title="Import" aria-label="Import"
          onClick={() => C.importPaste(areaRef.current ? areaRef.current.value : "")}>↵</button>
      </div>
    </div>
  );
}

function StillPanel({ open }: { open: boolean }) {
  return (
    <div className={"panel" + (open ? " open" : "")} id="stillPanel">
      <span className="label">still · maximum detail</span>
      <span id="stillNote">Heavy load. May be unstable on some devices.</span>
      <div className="panelRow">
        <button className="btn sym" id="stillCancel" title="Cancel" aria-label="Cancel"
          onClick={C.closePanels}>✕</button>
        <button className="btn sym" id="stillGo" title="Enable" aria-label="Enable"
          onClick={C.stillGo}>↵</button>
      </div>
    </div>
  );
}

export default function App() {
  const s = useSnapshot();
  const sceneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    C.init(sceneRef.current!);
  }, []);

  const dots = s.bookmarks.slice(-8);
  // 手帳ドット列は内容変化時に全体を再マウントし、スケールインを
  // artifact と同じく列ごと再生する
  const dotsKey = s.bookmarks.map(b => b.a).join("|");

  return (
    <>
      <div id="scene" ref={sceneRef}></div>

      <div id="readout">
        <div className="row"><span className="label">seed</span><span className="val" id="seedVal">{s.seed}</span></div>
        <div className="row"><span className="label">scale</span><span className="val" id="scaleVal">{s.scale}</span></div>
      </div>

      <div id="nbTrigger" title="Notebook" onClick={C.toggleNotebook}>
        <div id="nbDots" key={dotsKey}>
          {dots.map(b => (
            <div className="nbDot" key={b.a} style={{ color: b.colorCss, background: b.colorCss }}></div>
          ))}
        </div>
        <div id="nbCount">✧ {s.bookmarks.length}</div>
      </div>

      <div id="hud">
        <div id="addrLine" title="Copy address" onClick={C.copyViewAddress}>
          <span className="label">address</span>
          <span id="addrText" className="mono">{s.addrStr}</span>
        </div>
        <div id="metaRow">
          <span className="label">fp</span>
          <span id="fpText">{s.fp}</span>
          <button className="btn sym mini" id="btnVerify" title="Verify" aria-label="Verify"
            onClick={C.verify}>✓</button>
          <span id="verifyMsg" style={{ color: s.verify ? (s.verify.ok ? "var(--ok)" : "var(--bad)") : undefined }}>
            {s.verify ? s.verify.msg : ""}
          </span>
          <span className="spacer"></span>
          <span className="label">z</span>
          <ZReadout />
        </div>
        <div id="btnRow">
          <button className={"btn sym" + (s.marked ? " active" : "")} id="btnMark" title="Mark" aria-label="Mark"
            onClick={C.toggleMark}>{s.marked ? "✦" : "✧"}</button>
          <button className="btn sym" id="btnUp" title="Up" aria-label="Up" disabled={!s.canUp}
            onClick={C.up}>↑</button>
          <button className="btn sym" id="btnBack" title="Back" aria-label="Back" disabled={!s.canBack}
            onClick={C.back}>←</button>
          <button className="btn sym" id="btnJump" title="Jump" aria-label="Jump"
            onClick={C.openJump}>⌖</button>
          <span className="spacer"></span>
          <button className="btn" id="btnDetail" title="Detail" aria-label="Detail"
            onClick={C.cycleDetail}>{s.detailKey}</button>
          <button className={"btn" + (s.stillActive ? " active" : "")} id="btnStill" title="Still" aria-label="Still"
            onClick={C.stillButton}>Still</button>
          <button className="btn sym" id="btnShot" title="Capture" aria-label="Capture"
            onClick={C.captureShot}>◉</button>
        </div>
      </div>

      <JumpPanel open={s.panel === "jump"} prefill={s.jumpPrefill} msg={s.jumpMsg} />
      <NotebookPanel open={s.panel === "notebook"} bookmarks={s.bookmarks} />
      <PastePanel open={s.panel === "paste"} msg={s.pasteMsg} />
      <StillPanel open={s.panel === "still"} />

      <div id="toast" className={s.toastShow ? "show" : ""}>{s.toastText}</div>
      <div id="veil" className={s.veilOn ? "on" : ""}><span id="veilMsg">{s.veilMsg}</span></div>
    </>
  );
}
