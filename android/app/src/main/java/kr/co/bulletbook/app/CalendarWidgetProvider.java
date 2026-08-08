package kr.co.bulletbook.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.GridLayout;

import org.json.JSONObject;

import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 홈 화면 1개월 캘린더 위젯.
 *
 * 데이터는 MainActivity의 CloudAccountBridge가 SharedPreferences의
 * "calendar_widget_v1_json" 키로 저장한 위젯 전용 snapshot에서 읽는다.
 * snapshot 형식:
 *   {"version":1,"updatedAt":"...","days":{"2026-08-08":{"open":2,"completed":1,...}}}
 *
 * 위젯은 보기 전용이며 날짜·월·오늘 클릭 시 MainActivity로 Intent를 보낸다.
 */
public class CalendarWidgetProvider extends AppWidgetProvider {

    static final String PREFS = "bulletbook_cloud";
    static final String SNAPSHOT_KEY = "calendar_widget_v1_json";
    private static final DateTimeFormatter ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd");
    private static final DateTimeFormatter MONTH_LABEL =
        DateTimeFormatter.ofPattern("yyyy년 M월", Locale.KOREA);

    // 요일 헤더. 월요일 시작으로 앱의 주간 페이지 순서와 맞춘다.
    private static final String[] WEEKDAYS = {"월", "화", "수", "목", "금", "토", "일"};

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            renderWidget(context, manager, id);
        }
        scheduleNextDayAlarm(context);
    }

    @Override
    public void onEnabled(Context context) {
        scheduleNextDayAlarm(context);
    }

    @Override
    public void onDisabled(Context context) {
        cancelNextDayAlarm(context);
    }

    /** JS bridge가 snapshot을 저장한 직후 호출한다. */
    static void refreshWidgets(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName component = new ComponentName(context, CalendarWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(component);
        if (ids == null || ids.length == 0) return;
        for (int id : ids) {
            renderWidget(context, manager, id);
        }
    }

    private static void renderWidget(
        Context context, AppWidgetManager manager, int widgetId
    ) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_calendar);

        DayCounts counts = loadSnapshot(context);
        LocalDate today = LocalDate.now();
        YearMonth month = YearMonth.from(today);

        views.setTextViewText(R.id.widget_month_label, month.format(MONTH_LABEL));

        // 요일 헤더를 동적 칸으로 채운다.
        views.removeAllViews(R.id.widget_weekday_row);
        for (String label : WEEKDAYS) {
            RemoteViews cell = new RemoteViews(context.getPackageName(), R.layout.widget_calendar_cell);
            cell.setTextViewText(R.id.widget_cell_day, label);
            cell.setTextColor(R.id.widget_cell_day, Color.parseColor("#8a8478"));
            cell.setViewVisibility(R.id.widget_cell_dots, View.GONE);
            views.addView(R.id.widget_weekday_row, cell);
        }

        // 월요일(1)~일요일(7) 기준 시작 열을 계산한다.
        int firstDayOfWeek = month.atDay(1).getDayOfWeek().getValue(); // 1=MON .. 7=SUN
        int daysInMonth = month.lengthOfMonth();
        int prevMonthDays = firstDayOfWeek - 1; // 앞쪽 빈 칸 수

        views.removeAllViews(R.id.widget_date_grid);

        // 앞쪽 빈 칸
        for (int i = 0; i < prevMonthDays; i++) {
            views.addView(R.id.widget_date_grid, blankCell(context));
        }

        // 이번 달 날짜
        for (int day = 1; day <= daysInMonth; day++) {
            LocalDate date = month.atDay(day);
            String iso = date.format(ISO);
            DayCount count = counts.days.get(iso);
            RemoteViews cell = dateCell(context, day, date.isEqual(today), count);
            // 날짜별 고유 requestCode와 data URI로 PendingIntent identity를 보장한다.
            Intent open = new Intent(context, MainActivity.class);
            open.setAction(Intent.ACTION_VIEW);
            open.setData(Uri.parse("bulletbook://calendar/" + iso));
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int requestCode = (int) date.toEpochDay();
            PendingIntent pi = PendingIntent.getActivity(
                context, requestCode, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            cell.setOnClickPendingIntent(R.id.widget_cell_root, pi);
            views.addView(R.id.widget_date_grid, cell);
        }

        // 뒤쪽 빈 칸으로 마지막 줄을 7칸 단위로 맞춘다.
        int used = prevMonthDays + daysInMonth;
        int remainder = used % 7;
        if (remainder != 0) {
            for (int i = 0; i < 7 - remainder; i++) {
                views.addView(R.id.widget_date_grid, blankCell(context));
            }
        }

        // 월 라벨 클릭 → 해당 월의 월간 페이지
        Intent monthIntent = new Intent(context, MainActivity.class);
        monthIntent.setAction(Intent.ACTION_VIEW);
        monthIntent.setData(Uri.parse("bulletbook://month/" + month.format(DateTimeFormatter.ofPattern("yyyy-MM"))));
        monthIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent monthPi = PendingIntent.getActivity(
            context, 900000 + month.getYear() * 12 + month.getMonthValue(), monthIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_month_label, monthPi);

        // 오늘 버튼 → 오늘 일간 페이지
        Intent todayIntent = new Intent(context, MainActivity.class);
        todayIntent.setAction(Intent.ACTION_VIEW);
        todayIntent.setData(Uri.parse("bulletbook://calendar/" + today.format(ISO)));
        todayIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent todayPi = PendingIntent.getActivity(
            context, (int) today.toEpochDay() + 1000000, todayIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_today_button, todayPi);

        manager.updateAppWidget(widgetId, views);
    }

    private static RemoteViews blankCell(Context context) {
        RemoteViews cell = new RemoteViews(context.getPackageName(), R.layout.widget_calendar_cell);
        cell.setTextViewText(R.id.widget_cell_day, "");
        cell.setViewVisibility(R.id.widget_cell_dots, View.GONE);
        return cell;
    }

    private static RemoteViews dateCell(
        Context context, int day, boolean isToday, DayCount count
    ) {
        RemoteViews cell = new RemoteViews(context.getPackageName(), R.layout.widget_calendar_cell);
        cell.setTextViewText(R.id.widget_cell_day, String.valueOf(day));
        if (isToday) {
            cell.setTextColor(R.id.widget_cell_day, Color.parseColor("#ffffff"));
            cell.setInt(R.id.widget_cell_day, "setBackgroundResource", R.drawable.widget_today_background);
        } else {
            cell.setTextColor(R.id.widget_cell_day, Color.parseColor("#20201d"));
            cell.setInt(R.id.widget_cell_day, "setBackgroundResource", 0);
        }

        String dots = buildDots(count);
        if (dots.isEmpty()) {
            cell.setViewVisibility(R.id.widget_cell_dots, View.GONE);
        } else {
            cell.setViewVisibility(R.id.widget_cell_dots, View.VISIBLE);
            cell.setTextViewText(R.id.widget_cell_dots, dots);
            cell.setTextColor(R.id.widget_cell_dots, Color.parseColor("#c0560a"));
        }
        return cell;
    }

    /**
     * 일정 수에 따라 점 표시를 만든다.
     * 완료된 일정은 회색 점, 미완료는 주황 점으로 구분.
     * 3개 이상이면 점 3개 + 숫자로 표시한다.
     */
    private static String buildDots(DayCount count) {
        if (count == null) return "";
        int open = count.open + count.migrated + count.scheduled;
        int completed = count.completed;
        int total = open + completed;
        if (total == 0) return "";
        if (total <= 3) {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < open && sb.length() < 3; i++) sb.append("●");
            for (int i = 0; i < completed && sb.length() < 3; i++) sb.append("◌");
            return sb.toString();
        }
        // 4개 이상: 점 3개로 축약하고 우측에 총 개수를 표시
        return "●●● " + total;
    }

    /** SharedPreferences에서 snapshot을 읽어 날짜별 카운트 맵으로 변환한다. */
    private static DayCounts loadSnapshot(Context context) {
        DayCounts result = new DayCounts();
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String json = prefs.getString(SNAPSHOT_KEY, "");
        if (json == null || json.isEmpty()) return result;
        try {
            JSONObject root = new JSONObject(json);
            JSONObject days = root.optJSONObject("days");
            if (days == null) return result;
            for (java.util.Iterator<String> it = days.keys(); it.hasNext(); ) {
                String key = it.next();
                JSONObject entry = days.optJSONObject(key);
                if (entry == null) continue;
                DayCount dc = new DayCount();
                dc.open = entry.optInt("open", 0);
                dc.completed = entry.optInt("completed", 0);
                dc.migrated = entry.optInt("migrated", 0);
                dc.scheduled = entry.optInt("scheduled", 0);
                result.days.put(key, dc);
            }
        } catch (Exception ignored) {
            // 손상된 snapshot은 빈 위젯으로 표시한다.
        }
        return result;
    }

    // ---- 자정 이후 갱신 (inexact alarm, 권한 불필요) ----

    private static final int ALARM_REQUEST_CODE = 0xB00C;

    private void scheduleNextDayAlarm(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        LocalDate next = LocalDate.now().plusDays(1);
        long triggerAt = next.atStartOfDay(java.time.ZoneId.systemDefault())
            .toInstant().toEpochMilli() + 5 * 60 * 1000L; // 다음날 00:05 ± window
        Intent intent = new Intent(context, CalendarWidgetProvider.class);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        PendingIntent pi = PendingIntent.getBroadcast(
            context, ALARM_REQUEST_CODE, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        am.setWindow(AlarmManager.RTC, triggerAt, 30 * 60 * 1000L, pi);
    }

    private void cancelNextDayAlarm(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent intent = new Intent(context, CalendarWidgetProvider.class);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        PendingIntent pi = PendingIntent.getBroadcast(
            context, ALARM_REQUEST_CODE, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        am.cancel(pi);
    }

    // ---- snapshot 데이터 모델 ----

    static final class DayCounts {
        final Map<String, DayCount> days = new HashMap<>();
    }

    static final class DayCount {
        int open;
        int completed;
        int migrated;
        int scheduled;
    }
}
