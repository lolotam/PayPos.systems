import { render, screen } from '@testing-library/react';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import {
  ArrowCounterClockwise,
  Bell,
  Building2,
  CircleAlert,
  Clock3,
  DeviceMobileSlash,
  EmptyState,
  House,
  Inbox,
  KeyRound,
  Languages,
  LayoutPanelLeft,
  LoaderCircle,
  LogOut,
  MapPin,
  Monitor,
  Moon,
  ShieldCheck,
  Smartphone,
  Star,
  Store,
  Sun,
  Upload,
  UserRound,
  WifiOff,
} from '../index.js';

type IconComponent = ComponentType<{ 'aria-hidden'?: boolean; className?: string }>;

const ICONS: readonly (readonly [string, IconComponent])[] = [
  ['Bell', Bell],
  ['ArrowCounterClockwise', ArrowCounterClockwise],
  ['Building2', Building2],
  ['Store', Store],
  ['MapPin', MapPin],
  ['House', House],
  ['ShieldCheck', ShieldCheck],
  ['UserRound', UserRound],
  ['WifiOff', WifiOff],
  ['CircleAlert', CircleAlert],
  ['Clock3', Clock3],
  ['DeviceMobileSlash', DeviceMobileSlash],
  ['LoaderCircle', LoaderCircle],
  ['Inbox', Inbox],
  ['LogOut', LogOut],
  ['KeyRound', KeyRound],
  ['Languages', Languages],
  ['Upload', Upload],
  ['Smartphone', Smartphone],
  ['Sun', Sun],
  ['Moon', Moon],
  ['Monitor', Monitor],
  ['Star', Star],
  ['LayoutPanelLeft', LayoutPanelLeft],
];

it.each(ICONS)('%s renders an SVG in client DOM and SSR markup', (_name, Icon) => {
  const { container } = render(createElement(Icon, { 'aria-hidden': true }));
  const svg = container.querySelector('svg');
  expect(svg).not.toBeNull();

  const html = renderToStaticMarkup(createElement(Icon, { 'aria-hidden': true }));
  expect(html).toContain('<svg');
});

it('renders DeviceMobileSlash as the unsupported-device glyph', () => {
  const { container } = render(<DeviceMobileSlash aria-hidden />);
  expect(container.querySelector('svg')).not.toBeNull();
  expect(container.querySelectorAll('path').length).toBeGreaterThan(0);
});

it('defaults exported icons to 24px', () => {
  const { container } = render(<Bell aria-hidden />);
  const svg = container.querySelector('svg');
  expect(svg?.getAttribute('width')).toBe('24');
  expect(svg?.getAttribute('height')).toBe('24');
});

it('keeps an explicit size prop over the 24px default', () => {
  const { container } = render(<Bell aria-hidden size={32} />);
  const svg = container.querySelector('svg');
  expect(svg?.getAttribute('width')).toBe('32');
  expect(svg?.getAttribute('height')).toBe('32');
});

it('does not force 24px when the caller passes a size-* class', () => {
  const { container } = render(<Bell aria-hidden className="size-5" />);
  const svg = container.querySelector('svg');
  expect(svg?.getAttribute('width')).not.toBe('24');
  expect(svg?.getAttribute('height')).not.toBe('24');
  expect(svg?.classList.contains('size-5')).toBe(true);
});

it('mirrors the directional LogOut icon in RTL and leaves other icons alone', () => {
  const { container } = render(
    <>
      <LogOut aria-hidden className="extra" data-testid="logout" />
      <Bell aria-hidden data-testid="bell" />
    </>,
  );
  const logout = container.querySelector('[data-testid="logout"]');
  expect(logout?.classList.contains('rtl:-scale-x-100')).toBe(true);
  expect(logout?.classList.contains('extra')).toBe(true);
  expect(
    container.querySelector('[data-testid="bell"]')?.classList.contains('rtl:-scale-x-100'),
  ).toBe(false);
});

it('renders EmptyState icons as hidden glyphs inside the aria-hidden wrapper', () => {
  render(<EmptyState icon={<CircleAlert />} title="fixture.title" />);
  const heading = screen.getByRole('heading', { name: 'fixture.title' });
  const wrapper = heading.parentElement?.querySelector('span[aria-hidden="true"]');
  const svg = wrapper?.querySelector('svg');
  expect(svg).not.toBeNull();
  expect(svg?.getAttribute('width')).toBe('24');
});
