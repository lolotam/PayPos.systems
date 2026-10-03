import { render, screen } from '@testing-library/react';
import { createElement, createRef, type ComponentType } from 'react';
import { expect, it } from 'vitest';

import { Badge } from '../badge.js';
import { Card } from '../card/card.js';
import { CardContent } from '../card/card-content.js';
import { CardFooter } from '../card/card-footer.js';
import { CardHeader } from '../card/card-header.js';
import { CardTitle } from '../card/card-title.js';
import { Input } from '../input.js';
import { Label } from '../label.js';
import { Separator } from '../separator.js';

const label = 'fixture.primitive';
// The props every primitive accepts, so one table can drive them all without a cast per test.
type Primitive = ComponentType<{ className?: string; title?: string; 'data-testid'?: string }>;
const components: readonly (readonly [string, Primitive, string, string, string])[] = [
  ['Input', Input, 'input', 'ps-3', 'ps-8'],
  ['Label', Label, 'label', 'text-sm', 'text-base'],
  ['Badge', Badge, 'span', 'py-1', 'py-2'],
  ['Separator', Separator, 'div', 'bg-border', 'bg-primary'],
  ['Card', Card, 'div', 'border-border', 'border-transparent'],
  ['CardHeader', CardHeader, 'div', 'gap-2', 'gap-4'],
  ['CardTitle', CardTitle, 'h3', 'text-lg', 'text-xl'],
  ['CardContent', CardContent, 'div', 'py-6', 'py-8'],
  ['CardFooter', CardFooter, 'div', 'gap-2', 'gap-4'],
];

const physicalDirection =
  /^(?:-?(?:ml|mr|pl|pr|left|right)-|text-(?:left|right)$|border-(?:l|r)(?:-|$)|rounded-(?:l|r)(?:-|$))/;

it.each(components)('%s renders its native element', (_name, Component, tagName) => {
  render(createElement(Component, { 'data-testid': label }));
  expect(screen.getByTestId(label).tagName.toLowerCase()).toBe(tagName);
});

it.each(components)(
  '%s merges a forwarded className with its base classes',
  (_name, Component, _tagName, baseClass, overrideClass) => {
    render(createElement(Component, { className: overrideClass, 'data-testid': label }));
    const classList = screen.getByTestId(label).classList;
    expect({
      base: classList.contains(baseClass),
      override: classList.contains(overrideClass),
    }).toEqual({ base: false, override: true });
  },
);

it.each(components)('%s forwards native props', (_name, Component) => {
  render(createElement(Component, { title: label, 'data-testid': label }));
  expect(screen.getByTestId(label).getAttribute('title')).toBe(label);
});

it.each(components)('%s forwards its native ref', (_name, Component) => {
  const ref = createRef<HTMLElement>();
  render(createElement(Component as ComponentType<{ ref: typeof ref }>, { ref }));
  expect(ref.current).toBeInstanceOf(HTMLElement);
});

it('keeps every primitive class list free of physical-direction utilities', () => {
  const { container } = render(
    <>
      <Input />
      <Label>{label}</Label>
      <Badge>{label}</Badge>
      <Separator />
      <Card>
        <CardHeader>
          <CardTitle>{label}</CardTitle>
        </CardHeader>
        <CardContent>{label}</CardContent>
        <CardFooter>{label}</CardFooter>
      </Card>
    </>,
  );
  const classes = [...container.querySelectorAll('[class]')].flatMap((element) => [
    ...element.classList,
  ]);
  expect(classes.filter((className) => physicalDirection.test(className))).toEqual([]);
});
