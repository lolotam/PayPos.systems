package systems.pospay.business;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (bridge == null) return;
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request != null ? request.getUrl() : null;
                String expectedHost = bridge.getHost();
                String path = url != null ? url.getPath() : null;
                // FR-007: /personal لازم ينفتح في المتصفح الخارجي، والاعتراض ضيّق: https + مضيف POS + المسار بس.
                // setSelector مع CATEGORY_BROWSABLE بيضمنوا حلّ متصفح خارجي، لأن فلتر MainActivity
                // نفسه بيستقبل /personal على نفس الـ host، فرجوع الـ Intent للتطبيق يعمل حلقة.
                if (url != null && "https".equals(url.getScheme())
                    && expectedHost != null && expectedHost.equals(url.getHost())
                    && path != null && ("/personal".equals(path) || path.startsWith("/personal/"))) {
                    try {
                        Intent browserIntent = new Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE);
                        browserIntent.setSelector(new Intent(Intent.ACTION_VIEW, Uri.parse("https://")));
                        startActivity(browserIntent);
                    } catch (ActivityNotFoundException ex) {
                        Log.w("PosPayBusiness", "No browser activity found for external personal web flow");
                    }
                    return true;
                }
                return super.shouldOverrideUrlLoading(view, request);
            }
        });
    }
}
