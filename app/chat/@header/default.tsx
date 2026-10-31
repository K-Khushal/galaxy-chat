// Header slot for /chat routes. Later milestones add routes under `@header`
// (model picker, chat title); until then it shows the product name.
export default function HeaderSlot() {
  return <span className="truncate font-medium tracking-tight">Galaxy</span>;
}
