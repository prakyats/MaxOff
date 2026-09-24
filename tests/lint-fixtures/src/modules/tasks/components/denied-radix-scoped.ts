// @ts-expect-error Fixture only: the scoped Radix packages are not installed (the app uses the
// `radix-ui` bundle), but the lint rule must refuse them if one ever is.
import * as Dialog from "@radix-ui/react-dialog";

export const wrong = Dialog;
