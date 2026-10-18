"use client";

import { useState, useTransition } from "react";
import { createCategoryAction } from "@/features/books/category-actions";

export function CategorySelect({ id, categories, initialValue = "", required = false }: { id: string; categories: string[]; initialValue?: string; required?: boolean }) {
  const [options, setOptions] = useState(() => [...new Set([...categories, ...(initialValue ? [initialValue] : [])])]);
  const [selected, setSelected] = useState(initialValue ? `saved:${initialValue}` : "");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const adding = selected === "add";
  const value = adding ? name.trim() : selected === "none" ? "" : selected.replace(/^saved:/, "");
  return <div className="field">
    <label htmlFor={id}>카테고리</label>
    <input type="hidden" name="type" value={value}/>
    <select id={id} className="select" required={required} value={selected} onChange={(event) => { setSelected(event.target.value); setMessage(""); }}>
      {required && <option value="" disabled>카테고리를 선택하세요</option>}
      <option value={required ? "none" : ""}>미분류</option>
      {options.map((category) => <option key={category} value={`saved:${category}`}>{category}</option>)}
      <option value="add">카테고리 추가</option>
    </select>
    {adding && <div className="stack-sm">
      <label htmlFor={`${id}-new`}>새 카테고리 이름</label>
      <input id={`${id}-new`} className="input" maxLength={120} required pattern=".*\S.*" value={name} onChange={(event) => setName(event.target.value)} autoFocus/>
      <button type="button" className="button button-outline" disabled={pending || !name.trim()} onClick={() => startTransition(async () => {
        try {
          const result = await createCategoryAction(name);
          if (result.error) { setMessage(result.error); return; }
          if (!result.name) return;
          setOptions((previous) => [...new Set([...previous, result.name!])]);
          setSelected(`saved:${result.name}`); setName(""); setMessage("카테고리를 추가했습니다.");
        } catch { setMessage("카테고리를 추가하지 못했습니다. 다시 시도해 주세요."); }
      })}>{pending ? "추가 중" : "추가"}</button>
    </div>}
    {message && <span className="muted small" role="status">{message}</span>}
  </div>;
}
