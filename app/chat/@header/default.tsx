// Header slot for /chat routes. Routes under `@header` can replace it (model
// picker, chat title); otherwise it shows the product name.
export default function HeaderSlot() {
  return <span className="truncate font-medium tracking-tight">Galaxy</span>;
}
