import { Component, type ReactNode } from 'react';

import { NOT_FOUND_MESSAGE } from './frame-test-support';

/** عنصر اختبار: يلتقط ما يرميه `notFound()` المحاكى ويرسم «Not found» كما تفعل صفحة الخطأ 404. */
export class NotFoundProbe extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (error.message !== NOT_FOUND_MESSAGE) throw error;
    return <p>Not found</p>;
  }
}
