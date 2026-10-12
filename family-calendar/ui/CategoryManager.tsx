import { useState, type FormEvent } from 'react';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { type EventCategory } from './calendar';
import { SOLID_COLORS, LEGACY_COLORS, colorText } from './color-palette';
import { friendlyError } from './firebase';

export function CategoryManager({categories,onSave}:{categories:EventCategory[];onSave:(c:EventCategory)=>Promise<void>}){
  const [draft,setDraft]=useState<EventCategory|null>(null),[deleting,setDeleting]=useState<EventCategory|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const save=async(category:EventCategory)=>{
    setBusy(true);setError('');setNotice('');
    try{await onSave(category);setDraft(null);setDeleting(null);setNotice(category.deleted?'분류를 삭제했어요. 일정은 미분류로 남아 있어요.':'분류를 저장했어요.');}
    catch(e){setError(friendlyError(e));}finally{setBusy(false);}
  };
  const swatches=(colors:ReadonlyArray<{name:string;color:string}>)=><div className="category-colors">{colors.map(({name,color})=><button type="button" key={color} aria-label={name} title={name} aria-pressed={draft?.color===color} style={{background:color,color:colorText(color)}} onClick={()=>setDraft(d=>d?{...d,color}:d)}>{draft?.color===color&&<Check size={21} strokeWidth={3}/>}</button>)}</div>;
  const selectedColor=[...SOLID_COLORS,...LEGACY_COLORS].find(c=>c.color===draft?.color);
  const submit=(e:FormEvent)=>{e.preventDefault();if(!draft)return;const label=draft.label.trim();if(!label){setError('분류 이름을 입력해 주세요.');return;}void save({...draft,label});};
  return <div className="category-manager">
    <p className="field-hint">모든 가족이 분류를 추가하고 이름·색상을 바꿀 수 있어요. 변경 내용은 가족 전체에 적용돼요.</p>
    <div className="category-list">{categories.map(c=><div key={c.id} className="category-item"><i style={{background:c.color}}/><strong>{c.label}</strong><button type="button" className="icon-button" aria-label={`${c.label} 분류 수정`} disabled={busy} onClick={()=>{setDraft({...c});setDeleting(null);setError('');setNotice('');}}><Pencil size={17}/></button><button type="button" className="icon-button" aria-label={`${c.label} 분류 삭제`} disabled={busy} onClick={()=>{setDeleting(c);setDraft(null);setError('');setNotice('');}}><Trash2 size={17}/></button></div>)}</div>
    {!categories.length&&<p className="field-hint">아직 분류가 없어요. 미분류로 일정을 저장하거나 새 분류를 추가해 보세요.</p>}
    {deleting&&<div className="category-delete" role="group" aria-label="분류 삭제 확인"><strong>‘{deleting.label}’ 분류를 삭제할까요?</strong><p>이 분류를 사용한 일정은 삭제되지 않고 ‘미분류’로 표시돼요.</p><div><button type="button" className="button" disabled={busy} onClick={()=>setDeleting(null)}>취소</button><button type="button" className="button danger" disabled={busy} onClick={()=>void save({...deleting,deleted:true})}>{busy?'삭제 중…':'분류 삭제하기'}</button></div></div>}
    {draft?<form className="category-edit" onSubmit={submit}>
      <label>분류 이름<input aria-label="분류 이름" value={draft.label} maxLength={24} required autoFocus disabled={busy} placeholder="예: 여행, 집안일, 반려동물" onChange={e=>setDraft({...draft,label:e.target.value})}/></label>
      <fieldset disabled={busy}><legend>분류 색상 <span className="palette-count">단색 24가지</span></legend>{swatches(SOLID_COLORS)}<details className="legacy-colors"><summary>기존 색상 8가지</summary>{swatches(LEGACY_COLORS)}</details><div className="category-color-preview" aria-live="polite"><span style={{background:draft.color,color:colorText(draft.color)}}>{draft.label.trim()||'일정 미리보기'}</span><small>{selectedColor?.name||'현재 색상'}</small></div></fieldset>
      <div className="category-edit-actions"><button type="button" className="button" disabled={busy} onClick={()=>setDraft(null)}>취소</button><button className="button primary" disabled={busy}>{busy?'저장 중…':'분류 저장'}</button></div>
    </form>:<button type="button" className="button full" disabled={busy} onClick={()=>{setDraft({id:crypto.randomUUID(),label:'',color:SOLID_COLORS[10].color,deleted:false});setDeleting(null);setError('');setNotice('');}}><Plus size={17}/>분류 추가</button>}
    {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="form-info" role="status">{notice}</p>}
  </div>;
}
