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

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 홈 화면 한 달 달력 위젯.
 *
 * 데이터는 MainActivity의 CloudAccountBridge가 SharedPreferences에 저장한
 * calendar_widget_v1_json 스냅샷에서 읽는다. 날짜를 누르면 현재 페이지 쓰기를
 * 열어 일반 기록·일정·루틴을 추가하고, 월 제목은 기존 월간 계획을 연다.
 */
public class CalendarWidgetProvider extends AppWidgetProvider {

    static final String PREFS = "bulletbook_cloud";
    static final String SNAPSHOT_KEY = "calendar_widget_v1_json";
    static final String DISPLAY_MONTH_KEY_PREFIX = "calendar_widget_month_";
    static final String ACTION_PREVIOUS_MONTH =
        "kr.co.bulletbook.app.action.WIDGET_PREVIOUS_MONTH";
    static final String ACTION_NEXT_MONTH =
        "kr.co.bulletbook.app.action.WIDGET_NEXT_MONTH";
    static final String ACTION_CURRENT_MONTH =
        "kr.co.bulletbook.app.action.WIDGET_CURRENT_MONTH";

    private static final DateTimeFormatter ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd");
    private static final DateTimeFormatter MONTH = DateTimeFormatter.ofPattern("yyyy-MM");
    private static final DateTimeFormatter MONTH_LABEL =
        DateTimeFormatter.ofPattern("yyyy년 M월", Locale.KOREA);
    private static final String[] WEEKDAYS = {"월", "화", "수", "목", "금", "토", "일"};

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            refreshWidgets(context);
            return;
        }
        if (!ACTION_PREVIOUS_MONTH.equals(action)
            && !ACTION_NEXT_MONTH.equals(action)
            && !ACTION_CURRENT_MONTH.equals(action)) {
            return;
        }

        int widgetId = intent.getIntExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID
        );
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return;

        YearMonth currentMonth = YearMonth.from(LocalDate.now());
        YearMonth displayedMonth = loadDisplayedMonth(context, widgetId, currentMonth);
        if (ACTION_PREVIOUS_MONTH.equals(action)) {
            displayedMonth = shiftMonth(displayedMonth, -1);
        } else if (ACTION_NEXT_MONTH.equals(action)) {
            displayedMonth = shiftMonth(displayedMonth, 1);
        } else {
            displayedMonth = currentMonth;
        }
        saveDisplayedMonth(context, widgetId, displayedMonth, currentMonth);
        renderWidget(context, AppWidgetManager.getInstance(context), widgetId);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            renderWidget(context, manager, id);
        }
        scheduleNextDayAlarm(context);
    }

    @Override
    public void onDeleted(Context context, int[] appWidgetIds) {
        SharedPreferences.Editor editor =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        for (int id : appWidgetIds) editor.remove(displayMonthKey(id));
        editor.apply();
    }

    @Override
    public void onEnabled(Context context) {
        scheduleNextDayAlarm(context);
    }

    @Override
    public void onDisabled(Context context) {
        cancelNextDayAlarm(context);
    }

    /** JS bridge가 스냅샷을 저장한 직후 호출한다. */
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
        YearMonth currentMonth = YearMonth.from(today);
        YearMonth month = loadDisplayedMonth(context, widgetId, currentMonth);

        views.setTextViewText(R.id.widget_month_label, month.format(MONTH_LABEL));
        views.setOnClickPendingIntent(
            R.id.widget_previous_month_button,
            monthActionPendingIntent(context, widgetId, ACTION_PREVIOUS_MONTH, "previous")
        );
        views.setOnClickPendingIntent(
            R.id.widget_next_month_button,
            monthActionPendingIntent(context, widgetId, ACTION_NEXT_MONTH, "next")
        );

        // 가중치가 있는 LinearLayout 행을 써서 One UI 런처에서도 7×6 크기를 보장한다.
        views.removeAllViews(R.id.widget_weekday_row);
        for (String label : WEEKDAYS) {
            RemoteViews cell = new RemoteViews(
                context.getPackageName(), R.layout.widget_calendar_weekday_cell
            );
            cell.setTextViewText(R.id.widget_weekday_label, label);
            views.addView(R.id.widget_weekday_row, cell);
        }

        views.removeAllViews(R.id.widget_date_grid);
        List<LocalDate> dates = visibleDates(month);
        for (int week = 0; week < 6; week++) {
            RemoteViews row = new RemoteViews(
                context.getPackageName(), R.layout.widget_calendar_row
            );
            for (int weekday = 0; weekday < 7; weekday++) {
                LocalDate date = dates.get(week * 7 + weekday);
                String iso = date.format(ISO);
                RemoteViews cell = dateCell(
                    context,
                    date,
                    YearMonth.from(date).equals(month),
                    date.isEqual(today),
                    counts.days.get(iso)
                );
                cell.setOnClickPendingIntent(
                    R.id.widget_cell_root, datePendingIntent(context, date)
                );
                row.addView(R.id.widget_calendar_row, cell);
            }
            views.addView(R.id.widget_date_grid, row);
        }

        Intent monthIntent = new Intent(context, MainActivity.class);
        monthIntent.setAction(Intent.ACTION_VIEW);
        monthIntent.setData(Uri.parse("bulletbook://month/" + month.format(MONTH)));
        monthIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent monthPi = PendingIntent.getActivity(
            context, 900000 + month.getYear() * 12 + month.getMonthValue(), monthIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_month_label, monthPi);

        if (month.equals(currentMonth)) {
            Intent todayIntent = new Intent(context, MainActivity.class);
            todayIntent.setAction(Intent.ACTION_VIEW);
            todayIntent.setData(Uri.parse("bulletbook://calendar/" + today.format(ISO)));
            todayIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent todayPi = PendingIntent.getActivity(
                context, (int) today.toEpochDay() + 1000000, todayIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            views.setOnClickPendingIntent(R.id.widget_today_button, todayPi);
        } else {
            views.setOnClickPendingIntent(
                R.id.widget_today_button,
                monthActionPendingIntent(context, widgetId, ACTION_CURRENT_MONTH, "today")
            );
        }

        manager.updateAppWidget(widgetId, views);
    }

    static YearMonth shiftMonth(YearMonth month, int offset) {
        return month.plusMonths(offset);
    }

    static YearMonth parseDisplayedMonth(String value, YearMonth fallback) {
        if (value == null || value.isEmpty()) return fallback;
        try {
            return YearMonth.parse(value, MONTH);
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private static YearMonth loadDisplayedMonth(
        Context context, int widgetId, YearMonth fallback
    ) {
        String value = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(displayMonthKey(widgetId), "");
        return parseDisplayedMonth(value, fallback);
    }

    private static void saveDisplayedMonth(
        Context context, int widgetId, YearMonth month, YearMonth currentMonth
    ) {
        SharedPreferences.Editor editor =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        if (month.equals(currentMonth)) {
            editor.remove(displayMonthKey(widgetId));
        } else {
            editor.putString(displayMonthKey(widgetId), month.format(MONTH));
        }
        editor.apply();
    }

    private static String displayMonthKey(int widgetId) {
        return DISPLAY_MONTH_KEY_PREFIX + widgetId;
    }

    private static PendingIntent monthActionPendingIntent(
        Context context, int widgetId, String action, String suffix
    ) {
        Intent intent = new Intent(context, CalendarWidgetProvider.class);
        intent.setAction(action);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        intent.setData(Uri.parse("bulletbook-widget://month/" + widgetId + "/" + suffix));
        return PendingIntent.getBroadcast(
            context,
            widgetId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    static List<LocalDate> visibleDates(YearMonth month) {
        LocalDate first = month.atDay(1);
        LocalDate start = first.minusDays(first.getDayOfWeek().getValue() - 1L);
        List<LocalDate> dates = new ArrayList<>(42);
        for (int index = 0; index < 42; index++) {
            dates.add(start.plusDays(index));
        }
        return dates;
    }

    private static PendingIntent datePendingIntent(Context context, LocalDate date) {
        String iso = date.format(ISO);
        Intent open = new Intent(context, MainActivity.class);
        open.setAction(Intent.ACTION_VIEW);
        open.setData(Uri.parse("bulletbook://calendar/" + iso));
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
            context,
            (int) date.toEpochDay(),
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static RemoteViews dateCell(
        Context context,
        LocalDate date,
        boolean isCurrentMonth,
        boolean isToday,
        DayCount count
    ) {
        RemoteViews cell = new RemoteViews(context.getPackageName(), R.layout.widget_calendar_cell);
        cell.setTextViewText(R.id.widget_cell_day, String.valueOf(date.getDayOfMonth()));
        if (isToday) {
            cell.setTextColor(R.id.widget_cell_day, Color.parseColor("#ffffff"));
            cell.setInt(
                R.id.widget_cell_day,
                "setBackgroundResource",
                R.drawable.widget_today_background
            );
        } else {
            cell.setTextColor(
                R.id.widget_cell_day,
                Color.parseColor(isCurrentMonth ? "#20201d" : "#9c978d")
            );
            cell.setInt(R.id.widget_cell_day, "setBackgroundResource", 0);
        }

        String summary = eventSummary(count);
        if (summary.isEmpty()) {
            cell.setViewVisibility(R.id.widget_cell_dots, View.GONE);
        } else {
            cell.setViewVisibility(R.id.widget_cell_dots, View.VISIBLE);
            cell.setTextViewText(R.id.widget_cell_dots, summary);
            cell.setTextColor(
                R.id.widget_cell_dots,
                Color.parseColor(isCurrentMonth ? "#504b43" : "#a39d92")
            );
        }
        return cell;
    }

    /** 일정 제목을 최대 세 줄로 만들고 남은 수를 표시한다. */
    static String eventSummary(DayCount count) {
        if (count == null) return "";
        int open = count.open + count.migrated + count.scheduled;
        int completed = count.completed;
        int total = open + completed;
        if (total == 0) return "";
        if (!count.items.isEmpty()) {
            int shown = Math.min(count.items.size(), total > count.items.size() ? 2 : 3);
            StringBuilder summary = new StringBuilder();
            for (int index = 0; index < shown; index++) {
                if (summary.length() > 0) summary.append('\n');
                summary.append(count.items.get(index));
            }
            int remaining = total - shown;
            if (remaining > 0) summary.append("\n+").append(remaining);
            return summary.toString();
        }
        StringBuilder dots = new StringBuilder();
        for (int index = 0; index < Math.min(total, 3); index++) dots.append("•");
        if (total > 3) dots.append(' ').append(total);
        return dots.toString();
    }

    /** SharedPreferences의 스냅샷을 날짜별 일정 수로 변환한다. */
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
                JSONArray items = entry.optJSONArray("items");
                if (items != null) {
                    for (int index = 0; index < Math.min(items.length(), 3); index++) {
                        String item = items.optString(index, "")
                            .replaceAll("\\s+", " ")
                            .trim();
                        if (!item.isEmpty()) {
                            dc.items.add(item.substring(0, Math.min(item.length(), 80)));
                        }
                    }
                }
                result.days.put(key, dc);
            }
        } catch (Exception ignored) {
            // 손상된 스냅샷은 빈 위젯으로 표시한다.
        }
        return result;
    }

    private static final int ALARM_REQUEST_CODE = 0xB00C;

    private void scheduleNextDayAlarm(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        LocalDate next = LocalDate.now().plusDays(1);
        long triggerAt = next.atStartOfDay(java.time.ZoneId.systemDefault())
            .toInstant().toEpochMilli() + 5 * 60 * 1000L;
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

    static final class DayCounts {
        final Map<String, DayCount> days = new HashMap<>();
    }

    static final class DayCount {
        int open;
        int completed;
        int migrated;
        int scheduled;
        final List<String> items = new ArrayList<>();
    }
}
