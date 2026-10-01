import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';

import { noPhysicalTailwind } from './no-physical-tailwind.js';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const physical = [
  'ml-2',
  'mr-2',
  'pl-2',
  'pr-2',
  'left-0',
  'right-0',
  'text-left',
  'text-right',
  'border-l',
  'border-r',
  'border-l-2',
  'border-r-red-500',
  'rounded-l',
  'rounded-r-lg',
  'rounded-tl-lg',
  'rounded-br',
  'float-left',
  'float-right',
  'scroll-ml-2',
  'scroll-mr-2',
  '-ml-2',
  'md:ml-2',
  'dark:md:hover:-mr-2',
  'rtl:pl-4',
  'md:-scroll-mr-2',
  '[&:nth-child(2)]:-left-[2px]',
  'hover:!ml-2',
  'ml-2!',
  'scroll-pl-4',
  'scroll-pr-4',
  'clear-left',
  'clear-right',
  '[padding-left:1rem]',
  '[margin-right:1rem]',
  '[border-top-left-radius:2px]',
  '[left:0]',
  'md:[text-align:right]',
];
const invalid = (code) => ({ code, errors: [{ messageId: 'physical' }] });

tester.run('no-physical-tailwind', noPhysicalTailwind, {
  valid: [
    '<div className="ms-2 me-2 ps-2 pe-2 start-0 end-0 text-start text-end border-s border-e rounded-s rounded-e float-start scroll-ms-2 scroll-me-2" />',
    '<div className={cn("md:-ms-2", active && "lg:pe-4")} />',
    'cva("border rounded-lg", { variants: { size: { sm: "ps-2 pe-2" } } })',
    'cn(`ps-2 ${active ? "ms-2" : "me-2"}`)',
    '<div title="ml-2" />',
    'const unrelated = "ml-2";',
    'cn("[&[data-label=left-0]]:ms-2", "text-[length:2rem]")',
    'cn("border-lime-500", "text-leftover")',
    'cn("[padding-inline-start:1rem]", "clear-start", "scroll-ps-4")',
    'cva("text-start", { variants: { align: { "text-left": "text-start" } } })',
    'cva("flex", { variants: { side: { start: "ms-2" } }, defaultVariants: { side: "text-left" } })',
    'cva("flex", { compoundVariants: [{ align: "text-left", className: "ms-2" }] })',
    'cn(side === "left-0" && "ms-2")',
    'cn({ "ms-2": side === "ml-2" })',
    'cn(flags["ml-2"] && "ms-2")',
    'cn(options.includes("left-0") && "ms-2")',
    'cn(isSide("ml-2") ? "ms-2" : "me-2")',
    'cva({ "ms-2": true }, { variants: { size: { sm: { "ps-2": true } } } })',
  ],
  invalid: [
    ...physical.map((className) => invalid(`<div className="${className}" />`)),
    invalid('<div className={"ml-2"} />'),
    invalid('<div className={`mr-2 ${active}`} />'),
    invalid('cn("ml-2")'),
    invalid('cn({ "hover:mr-2": active })'),
    invalid('cn(`ms-2 ${active ? "pl-2" : "pe-2"}`)'),
    invalid('cn(`md:-ml-${size}`)'),
    invalid('cva(`pr-2`)'),
    invalid('cva("flex", { variants: { size: { sm: "pl-2" } } })'),
    invalid('cva("flex", { compoundVariants: [{ active: true, className: `md:ml-2` }] })'),
    invalid('cn("ml-2" + " flex")'),
    invalid('cva({ "ml-2": true })'),
    invalid('cva(["flex", "pl-2"])'),
    invalid('cva("flex", { variants: { size: { sm: { "pr-2": true } } } })'),
    invalid('cva("flex", { compoundVariants: [{ active: true, className: { "ml-2": true } }] })'),
    { code: 'cn("ml-2 mr-3")', errors: [{ messageId: 'physical' }, { messageId: 'physical' }] },
  ],
});
