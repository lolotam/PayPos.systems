import { useNavStyle } from './nav-style-context';

export function NavStyleSaveProbe() {
  const { style, setStyle } = useNavStyle();
  return <>
    <p>Frame {style}</p>
    {(['A', 'B', 'C'] as const).map((next) => <button key={next} onClick={() => setStyle(next)}>Choose {next}</button>)}
  </>;
}
