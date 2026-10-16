(() => {
  'use strict';
  const TITLE_LIMIT = 240;
  const COLLAPSED_KEY = 'bulletbook.inbox.collapsed.v1';

  function normalizeTasks(value) {
    if (!Array.isArray(value)) return [];
    const tasks = new Map();
    value.forEach((task, index) => {
      if (!task || typeof task !== 'object' || typeof task.title !== 'string') return;
      const title = task.title.trim().slice(0, TITLE_LIMIT);
      if (!title) return;
      const id = typeof task.id === 'string' && task.id ? task.id : `inbox-import-${index}`;
      const normalized = {...task, id, title, completed:task.completed === true, deleted:task.deleted === true};
      const previous = tasks.get(id);
      if (!previous || (Date.parse(task.updatedAt) || 0) >= (Date.parse(previous.updatedAt) || 0)) tasks.set(id, normalized);
    });
    return [...tasks.values()];
  }

  function addTask(tasks, title, id, now) {
    const clean = String(title).trim().slice(0, TITLE_LIMIT);
    if (!clean) return tasks;
    return [...tasks, {id, title:clean, completed:false, deleted:false, createdAt:now, updatedAt:now}];
  }

  function updateTask(tasks, id, changes, now) {
    return tasks.map(task => {
      if (task.id !== id) return task;
      const patch = {};
      if (typeof changes.title === 'string') {
        patch.title = changes.title.trim().slice(0, TITLE_LIMIT);
        if (!patch.title) return task;
      }
      for (const key of ['completed', 'deleted']) if (typeof changes[key] === 'boolean') patch[key] = changes[key];
      return {...task, ...patch, updatedAt:now};
    });
  }

  function create({element, getBook, commit, notify}) {
    const find = selector => element.querySelector(selector);
    const toggle = find('#inboxToggle'), body = find('#inboxBody'), count = find('#inboxCount');
    const disclosure = find('#inboxDisclosure');
    const completedButton = find('#inboxCompleted'), list = find('#inboxList');
    const form = find('#inboxAddForm'), input = find('#inboxInput');
    const undo = find('#inboxUndo');
    let collapsed = true, showCompleted = false, editing = null, lastDeleted = null;
    let renderedBook = '', signature = '';
    try { collapsed = localStorage.getItem(COLLAPSED_KEY) !== '0'; } catch { /* Optional display preference. */ }
    const button = (text, label, action, className = '') => {
      const node = document.createElement('button');
      node.type = 'button'; node.textContent = text; node.className = className;
      if (label) node.setAttribute('aria-label', label);
      node.addEventListener('click', action);
      return node;
    };
    const mutate = (id, changes) => {
      const book = getBook();
      book.inboxTasks = updateTask(book.inboxTasks || [], id, changes, new Date().toISOString());
      commit(); render();
    };
    const focusRow = (id, selector = '.inbox-check') => {
      const row = [...list.children].find(node => node.dataset.taskId === id);
      (row?.querySelector(selector) || completedButton).focus();
    };
    // Checklist keyboard input must not trigger canvas tools or page shortcuts.
    // Keep document-wide save and undo/redo available.
    element.addEventListener('keydown', event => {
      if (!(event.ctrlKey || event.metaKey) || !['s', 'z', 'y'].includes(event.key.toLowerCase())) event.stopPropagation();
    });

    function render() {
      const book = getBook();
      if (renderedBook !== book.id) {
        renderedBook = book.id; editing = null; lastDeleted = null; signature = '';
        input.value = ''; showCompleted = false;
      }
      element.removeAttribute('inert');
      const tasks = (book.inboxTasks || []).filter(task => !task.deleted);
      const open = tasks.filter(task => !task.completed), done = tasks.filter(task => task.completed);
      count.textContent = String(open.length);
      count.setAttribute('aria-label', `남은 할 일 ${open.length}개`);
      completedButton.textContent = showCompleted ? `할 일 ${open.length}` : `완료 ${done.length}`;
      completedButton.setAttribute('aria-pressed', String(showCompleted));
      toggle.setAttribute('aria-expanded', String(!collapsed));
      disclosure.setAttribute('aria-expanded', String(!collapsed));
      const action = collapsed ? '펼치기' : '접기';
      toggle.setAttribute('aria-label', `언젠가 할 일 ${action}, 남은 ${open.length}개`);
      disclosure.setAttribute('aria-label', `할 일 ${action}`);
      find('.inbox-toggle-label').textContent = action;
      find('.inbox-chevron').textContent = collapsed ? '▼' : '▲';
      body.hidden = collapsed; element.dataset.collapsed = String(collapsed);
      undo.hidden = !lastDeleted || !book.inboxTasks?.some(task => task.id === lastDeleted && task.deleted);
      const next = JSON.stringify([book.id, tasks, showCompleted, editing?.id]);
      if (next === signature) return;
      signature = next;
      const focused = list.contains(document.activeElement) ? document.activeElement : null;
      const focusId = focused?.closest('[data-task-id]')?.dataset.taskId;
      const selection = focused?.matches('input[type=text]') ? [focused.selectionStart, focused.selectionEnd] : null;
      const scrollTop = list.scrollTop;
      list.replaceChildren();
      const visible = showCompleted ? done : open;
      list.setAttribute('aria-label', showCompleted ? '완료한 할 일' : '언젠가 할 일 목록');
      if (!visible.length) {
        const empty = document.createElement('li'); empty.className = 'inbox-empty';
        empty.textContent = showCompleted ? '완료한 일이 아직 없어요.' : '언젠가 해야 할 일, 잊기 전에 적어두세요.';
        list.append(empty);
      }
      visible.forEach(task => {
        const row = document.createElement('li'); row.dataset.taskId = task.id;
        row.className = `inbox-task${task.completed ? ' is-completed' : ''}`;
        if (editing?.id === task.id) {
          const editForm = document.createElement('form'); editForm.className = 'inbox-edit-form';
          const field = document.createElement('input'); field.type = 'text'; field.maxLength = TITLE_LIMIT;
          field.required = true; field.value = editing.value; field.setAttribute('aria-label', '할 일 수정');
          field.addEventListener('input', () => { editing.value = field.value; });
          field.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); editing = null; render(); focusRow(task.id, '.inbox-task-title'); }
          });
          const save = document.createElement('button'); save.type = 'submit'; save.textContent = '저장';
          editForm.addEventListener('submit', event => {
            event.preventDefault();
            const title = field.value.trim(); if (!title) { field.setCustomValidity('할 일을 입력해 주세요.'); field.reportValidity(); return; }
            field.setCustomValidity('');
            const latest = getBook().inboxTasks?.find(item => item.id === task.id);
            if (!latest || latest.deleted) { editing = null; render(); notify('이 할 일은 다른 곳에서 삭제됐어요.'); return; }
            if (latest.title !== editing.originalTitle) {
              editing.originalTitle = latest.title;
              notify('다른 기기에서 내용이 바뀌었어요. 입력한 내용으로 저장하려면 저장을 다시 눌러 주세요.'); return;
            }
            editing = null; mutate(task.id, {title}); focusRow(task.id, '.inbox-task-title');
          });
          field.addEventListener('input', () => field.setCustomValidity(''));
          editForm.append(field, save, button('취소', '할 일 수정 취소', () => { editing = null; render(); focusRow(task.id, '.inbox-task-title'); }));
          row.append(editForm);
        } else {
          const check = document.createElement('input'); check.type = 'checkbox'; check.className = 'inbox-check';
          check.checked = task.completed; check.setAttribute('aria-label', `${task.title} 완료`);
          check.addEventListener('change', () => { mutate(task.id, {completed:check.checked}); completedButton.focus(); });
          const title = button(task.title, `${task.title} 수정`, () => {
            editing = {id:task.id, value:task.title, originalTitle:task.title}; render();
            focusRow(task.id, 'input[type=text]');
          }, 'inbox-task-title');
          title.title = task.title;
          const remove = button('×', `${task.title} 삭제`, () => {
            lastDeleted = task.id; mutate(task.id, {deleted:true}); undo.focus(); notify('할 일을 삭제했어요. 실행 취소로 되돌릴 수 있어요.');
          }, 'inbox-delete');
          row.append(check, title, remove);
        }
        list.append(row);
      });
      list.scrollTop = scrollTop;
      if (focusId && editing?.id === focusId) {
        focusRow(focusId, 'input[type=text]');
        if (selection) document.activeElement.setSelectionRange(...selection);
      }
    }

    const setCollapsed = value => {
      collapsed = value;
      try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* Optional preference. */ }
      render();
    };
    toggle.addEventListener('click', () => setCollapsed(!collapsed));
    disclosure.addEventListener('click', () => setCollapsed(!collapsed));
    completedButton.addEventListener('click', () => { showCompleted = !showCompleted; editing = null; setCollapsed(false); });
    form.addEventListener('submit', event => {
      event.preventDefault();
      const title = input.value.trim();
      if (!title) { input.setCustomValidity('할 일을 입력해 주세요.'); input.reportValidity(); return; }
      const book = getBook();
      book.inboxTasks = addTask(book.inboxTasks || [], title, crypto.randomUUID(), new Date().toISOString());
      input.value = ''; input.setCustomValidity(''); showCompleted = false;
      commit(); render(); list.scrollTop = list.scrollHeight; input.focus();
    });
    input.addEventListener('input', () => input.setCustomValidity(''));
    undo.addEventListener('click', () => { const id = lastDeleted; lastDeleted = null; mutate(id, {deleted:false}); input.focus(); });
    return {render};
  }
  window.BulletBookInbox = {normalizeTasks, addTask, updateTask, create};
})();
