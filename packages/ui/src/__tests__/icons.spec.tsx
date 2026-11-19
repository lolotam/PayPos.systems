import { render, screen } from '@testing-library/react';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import {
  Bell,
  Building2,
  CircleAlert,
  Clock3,
  EmptyState,
  House,
  Inbox,
  KeyRound,
  Languages,
  LoaderCircle,
  LogOut,
  MapPin,
  Monitor,
  MonitorX,
  Moon,
  ShieldCheck,
  Smartphone,
  Store,
  Sun,
  Upload,
  UserRound,
  WifiOff,
} from '../index.js';

type IconComponent = ComponentType<{ 'aria-hidden'?: boolean; className?: string }>;

const ICONS: readonly (readonly [string, IconComponent])[] = [
  ['Bell', Bell],
  ['Building2', Building2],
  ['Store', Store],
  ['MapPin', MapPin],
  ['House', House],
  ['ShieldCheck', ShieldCheck],
  ['UserRound', UserRound],
  ['WifiOff', WifiOff],
  ['CircleAlert', CircleAlert],
  ['Clock3', Clock3],
  ['MonitorX', MonitorX],
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
];

it.each(ICONS)('%s renders an SVG in client DOM and SSR markup', (_name, Icon) => {
  const { container } = render(createElement(Icon, { 'aria-hidden': true }));
  const svg = container.querySelector('svg');
  expect(svg).not.toBeNull();

  const html = renderToStaticMarkup(createElement(Icon, { 'aria-hidden': true }));
  expect(html).toContain('<svg');
});

it('renders MonitorX with a distinct glyph from Monitor', () => {
  const unsupported = renderToStaticMarkup(<MonitorX aria-hidden />);
  const monitor = renderToStaticMarkup(<Monitor aria-hidden />);
  expect(unsupported).toContain('<svg');
  expect(monitor).toContain('<svg');
  expect(unsupported).not.toBe(monitor);
});

it('preserves default 24px (size-6) icon sizing and hidden glyph semantics in EmptyState', () => {
  render(<EmptyState icon={<CircleAlert />} title="fixture.title" />);
  const heading = screen.getByRole('heading', { name: 'fixture.title' });
  const card = heading.parentElement;
  expect(card).not.toBeNull();
  const wrapper = card?.querySelector('span[aria-hidden="true"]');
  expect(wrapper).not.toBeNull();
  expect(wrapper?.className).toContain('[&_svg:not([class*="size-"])]:size-6');
  expect(wrapper?.querySelector('svg')).not.toBeNull();
});
