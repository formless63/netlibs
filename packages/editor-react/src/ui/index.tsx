import { IconX } from '@tabler/icons-react';
import {
  AlertDialog as AlertDialogPrimitive,
  Dialog as DialogPrimitive,
  DropdownMenu as DropdownMenuPrimitive
} from 'radix-ui';
import { useSyncExternalStore, type ComponentProps, type JSX } from 'react';

import { cn } from './cn.ts';

/**
 * The editor's own small control set: Radix for focus/dismissal behaviour,
 * `.rich-ui-*` classes (editor.css) for looks. Internal to this package.
 */

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'icon';
};

export function Button({
  className,
  variant = 'default',
  size = 'default',
  type = 'button',
  ...props
}: ButtonProps): JSX.Element {
  return (
    <button
      className={cn('rich-ui-button', className)}
      data-size={size}
      data-variant={variant}
      type={type}
      {...props}
    />
  );
}

type ToggleProps = Omit<ComponentProps<'button'>, 'onClick'> & {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  size?: 'sm';
};

export function Toggle({
  className,
  pressed,
  onPressedChange,
  size: _size,
  ...props
}: ToggleProps): JSX.Element {
  return (
    <button
      aria-pressed={pressed}
      className={cn('rich-ui-button', className)}
      data-size='icon'
      data-state={pressed ? 'on' : 'off'}
      data-variant='ghost'
      onClick={() => onPressedChange(!pressed)}
      type='button'
      {...props}
    />
  );
}

export function Input({ className, ...props }: ComponentProps<'input'>): JSX.Element {
  return <input className={cn('rich-ui-input', className)} {...props} />;
}

export function Separator({
  className,
  orientation: _orientation,
  ...props
}: ComponentProps<'div'> & { orientation?: 'vertical' }): JSX.Element {
  return <div className={cn('rich-ui-separator', className)} role='none' {...props} />;
}

export const Dialog = DialogPrimitive.Root;

export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>): JSX.Element {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className='rich-ui-overlay' />
      <DialogPrimitive.Content className={cn('rich-ui-dialog', className)} {...props}>
        {children}
        <DialogPrimitive.Close aria-label='Close' className='rich-ui-dialog__close'>
          <IconX className='ce:size-4' />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader(props: ComponentProps<'div'>): JSX.Element {
  return <div {...props} className={cn('rich-ui-dialog__header', props.className)} />;
}

export function DialogFooter(props: ComponentProps<'div'>): JSX.Element {
  return <div {...props} className={cn('rich-ui-dialog__footer', props.className)} />;
}

export function DialogTitle(props: ComponentProps<typeof DialogPrimitive.Title>): JSX.Element {
  return <DialogPrimitive.Title {...props} className='rich-ui-dialog__title' />;
}

export function DialogDescription(
  props: ComponentProps<typeof DialogPrimitive.Description>
): JSX.Element {
  return <DialogPrimitive.Description {...props} className='rich-ui-dialog__description' />;
}

/** A dialog docked to the inline end; used for the outline on narrow screens. */
export const Sheet = DialogPrimitive.Root;
export const SheetHeader = DialogHeader;
export const SheetTitle = DialogTitle;
export const SheetDescription = DialogDescription;

export function SheetContent({
  className,
  side: _side,
  ...props
}: ComponentProps<typeof DialogContent> & { side?: 'right' }): JSX.Element {
  return <DialogContent className={cn('rich-ui-sheet', className)} {...props} />;
}

export const AlertDialog = AlertDialogPrimitive.Root;

export function AlertDialogContent({
  children,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Content>): JSX.Element {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className='rich-ui-overlay' />
      <AlertDialogPrimitive.Content className='rich-ui-dialog' {...props}>
        {children}
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  );
}

export const AlertDialogHeader = DialogHeader;
export const AlertDialogFooter = DialogFooter;

export function AlertDialogTitle(
  props: ComponentProps<typeof AlertDialogPrimitive.Title>
): JSX.Element {
  return <AlertDialogPrimitive.Title {...props} className='rich-ui-dialog__title' />;
}

export function AlertDialogDescription(
  props: ComponentProps<typeof AlertDialogPrimitive.Description>
): JSX.Element {
  return <AlertDialogPrimitive.Description {...props} className='rich-ui-dialog__description' />;
}

export function AlertDialogAction(
  props: ComponentProps<typeof AlertDialogPrimitive.Action>
): JSX.Element {
  return (
    <AlertDialogPrimitive.Action
      {...props}
      className='rich-ui-button'
      data-size='default'
      data-variant='default'
    />
  );
}

export function AlertDialogCancel(
  props: ComponentProps<typeof AlertDialogPrimitive.Cancel>
): JSX.Element {
  return (
    <AlertDialogPrimitive.Cancel
      {...props}
      className='rich-ui-button'
      data-size='default'
      data-variant='outline'
    />
  );
}

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent(
  props: ComponentProps<typeof DropdownMenuPrimitive.Content>
): JSX.Element {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content sideOffset={4} {...props} className='rich-ui-menu' />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem(
  props: ComponentProps<typeof DropdownMenuPrimitive.Item>
): JSX.Element {
  return <DropdownMenuPrimitive.Item {...props} className='rich-ui-menu__item' />;
}

const MOBILE_QUERY = '(max-width: 767px)';

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia?.(MOBILE_QUERY);
      query?.addEventListener('change', onChange);
      return () => query?.removeEventListener('change', onChange);
    },
    () => window.matchMedia?.(MOBILE_QUERY)?.matches ?? false,
    () => false
  );
}
