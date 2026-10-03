'use client';

import { ChevronDown } from 'lucide-react';
import { Select as SelectPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';

import { cn } from './shared/cn.js';

export interface SelectOption {
  readonly value: string;
  readonly label: ReactNode;
}

export interface SelectProps {
  id?: string | undefined;
  name?: string | undefined;
  value?: string | undefined;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

const triggerClass =
  'flex min-h-12 w-full items-center justify-between gap-2 rounded-interactive border border-input bg-card ps-3 pe-3 text-start text-base text-card-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50';

const itemClass =
  'flex cursor-pointer items-center rounded-interactive px-3 py-2 text-start outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground';

export function Select({
  id,
  name,
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
}: SelectProps) {
  return (
    <SelectPrimitive.Root
      value={value ?? ''}
      onValueChange={onValueChange}
      {...(name === undefined ? {} : { name })}
      {...(disabled === undefined ? {} : { disabled })}
    >
      <SelectPrimitive.Trigger
        className={cn(triggerClass, className)}
        {...(id === undefined ? {} : { id })}
      >
        <SelectPrimitive.Value {...(placeholder === undefined ? {} : { placeholder })} />
        <SelectPrimitive.Icon className="text-muted-foreground">
          <ChevronDown aria-hidden className="size-4" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          align="start"
          className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-interactive border border-border bg-card text-card-foreground shadow-sm"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item key={option.value} value={option.value} className={itemClass}>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
