import { getManualBookCategories } from "@/features/books/queries";
import { addProfileCategoryAction, deleteProfileCategoryAction } from "@/features/profile/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";

export function CategoryPanel() {
  const categories = getManualBookCategories();
  return <section className="panel stack-md" aria-labelledby="profile-categories-heading">
    <div><p className="eyebrow">Categories</p><h2 id="profile-categories-heading">카테고리 관리</h2></div>
    <form action={addProfileCategoryAction} className="profile-category-add">
      <div className="field"><label htmlFor="profile-category-name">새 카테고리</label><input id="profile-category-name" className="input" name="category" required maxLength={120}/></div>
      <SubmitButton pendingLabel="추가 중">카테고리 추가</SubmitButton>
    </form>
    <p className="muted small">책에 사용 중인 카테고리는 책의 분류를 변경한 후 삭제할 수 있습니다.</p>
    {categories.length ? <ul className="profile-category-list">{categories.map((name) => <li key={name}>
      <span>{name}</span><form action={deleteProfileCategoryAction}><input type="hidden" name="category" value={name}/>
        <ConfirmSubmitButton className="button button-danger-outline button-small" message={`‘${name}’ 카테고리를 삭제합니까?`}>삭제</ConfirmSubmitButton>
      </form></li>)}</ul> : <p className="muted small">등록된 카테고리가 없습니다.</p>}
  </section>;
}
