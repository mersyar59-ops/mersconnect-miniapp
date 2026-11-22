<?php
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../function.php';
require_once __DIR__ . '/utils.php';
require_once __DIR__ . '/../botapi.php';
require_once __DIR__ . '/../panels.php';
require_once __DIR__ . '/../jdf.php';
require_once __DIR__ . '/../keyboard.php';

header('Content-Type: application/json; charset=utf-8');
date_default_timezone_set('Asia/Tehran');
ini_set('default_charset', 'UTF-8');
ini_set('error_log', 'error_log');
$ManagePanel = new ManagePanel();
$headers = getallheaders();
$setting = config_all('setting');
$method = $_SERVER['REQUEST_METHOD'];
$data = null;
if ($method == "GET") {
    $data = array(
        'actions' => isset($_GET['actions']) && is_string($_GET['actions']) ? $_GET['actions'] : '',
        'user_id' => isset($_GET['user_id']) && is_numeric($_GET['user_id']) ? (int) $_GET['user_id'] : 0,
        'page' => isset($_GET['page']) && is_numeric($_GET['page']) && $_GET['page'] > 0 ? (int) $_GET['page'] : 1,
        'limit' => isset($_GET['limit']) && is_numeric($_GET['limit']) && $_GET['limit'] > 0 ? (int) $_GET['limit'] : 10,
        'q' => isset($_GET['q']) && is_string($_GET['q']) ? $_GET['q'] : null,
        'username' => isset($_GET['username']) && is_string($_GET['username']) ? $_GET['username'] : null,
        'id_panel' => isset($_GET['country_id']) && is_string($_GET['country_id']) ? $_GET['country_id'] : "",
        'category_id' => isset($_GET['category_id']) && is_string($_GET['category_id']) ? $_GET['category_id'] : 0,
        'time_range_day' => isset($_GET['time_range_day']) && is_string($_GET['time_range_day']) ? $_GET['time_range_day'] : 0,
        'traffic_gb' => isset($_GET['traffic_gb']) && is_string($_GET['traffic_gb']) ? $_GET['traffic_gb'] : 0,
        'time_days' => isset($_GET['time_days']) && is_string($_GET['time_days']) ? $_GET['time_days'] : 0,
        'order_id' => isset($_GET['order_id']) && is_string($_GET['order_id']) ? $_GET['order_id'] : ''
    );
} elseif ($method == "POST") {
    $data = json_decode(file_get_contents("php://input"), true);
}
if (!is_array($data)) {
    echo json_encode([
        'status' => false,
        'msg' => "Data invalid",
        'obj' => []
    ]);
    return;
}

$data = sanitize_recursive($data);

// Authenticate before touching anything else: the session token, not the
// client-supplied user_id, decides whose account this request acts on.
$usercheck = requireMiniappUser($headers, $tokencheck);
$data['user_id'] = $usercheck['id'];
$from_id = $usercheck['id'];
$textbotlang = languagechange();

$errorreport = topicId('errorreport');
$porsantreport = topicId('porsantreport');
$buyreport = topicId('buyreport');
$action = $data['actions'] ?? '';

function mini_invoices(array $data, string $method): void
{
    global $pdo, $textbotlang, $ManagePanel;

    if ($method !== "GET") {
        echo json_encode([
            'status' => false,
            'msg' => "Method invalid; must be GET",
        ]);
        return;
    }
    $limit = $data['limit'];
    if ($limit > 10)
        $limit = 10;
    $page = $data['page'];
    $user_id = $data['user_id'];
    $username = $data['q'];
    $offset = ($page - 1) * $limit;
    if ($username != null) {
        $querywhere = " AND username LIKE :username";
    } else {
        $querywhere = "";
    }
    $countStmt = $pdo->prepare("SELECT COUNT(*) as total FROM invoice WHERE id_user = :user_id AND (status = 'active' OR status = 'end_of_time'  OR status = 'end_of_volume' OR status = 'sendedwarn' OR Status = 'send_on_hold') $querywhere");
    $countStmt->bindValue(':user_id', $user_id);
    if ($username != null) {
        $username = "%$username%";
        $countStmt->bindValue(':username', $username, PDO::PARAM_STR);
    }
    $countStmt->execute();
    $totalItems = $countStmt->fetchColumn();
    $totalPages = ceil($totalItems / $limit);
    $stmt = $pdo->prepare("SELECT username,note,Service_location FROM invoice WHERE id_user = :user_id AND (status = 'active' OR status = 'end_of_time'  OR status = 'end_of_volume' OR status = 'sendedwarn' OR Status = 'send_on_hold') $querywhere  ORDER BY time_sell DESC LIMIT :limit OFFSET :offset ");
    $stmt->bindValue(':user_id', $user_id, PDO::PARAM_INT);
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    if ($username != null) {
        $username = "%$username%";
        $stmt->bindValue(':username', $username, PDO::PARAM_STR);
    }
    $stmt->execute();
    $invoices = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $datauser = [];
    if (is_array($invoices)) {
        foreach ($invoices as $invoice) {
            $DataUserOut = $ManagePanel->DataUser($invoice['Service_location'], $invoice['username']);
            if ($DataUserOut['status'] == "Unsuccessful") {
                $expire = $textbotlang['common']['labels']['unknown'];
            } else {
                $expire = $DataUserOut['expire'] ? jdate('Y/m/d', $DataUserOut['expire']) : $textbotlang['common']['labels']['unlimited'];
            }
            $datauser[] = [
                'username' => $invoice['username'],
                'status' => $DataUserOut['status'],
                'expire' => $expire,
                'note' => $invoice['note']
            ];
        }
    }
    echo json_encode([
        'status' => true,
        'msg' => "Successful",
        'obj' => $datauser,
        'meta' => [
            'currentPage' => $page,
            'totalPages' => $totalPages,
            'totalItems' => $totalItems,
            'limit' => $limit
        ]
    ]);
}

function mini_service(array $data, string $method): void
{
    global $pdo, $textbotlang, $ManagePanel;

    if ($method !== "GET") {
        echo json_encode([
            'status' => false,
            'msg' => "Method invalid; must be GET",
        ]);
        return;
    }
    $user_id = $data['user_id'];
    $username = $data['username'];
    $stmt = $pdo->prepare("SELECT * FROM invoice WHERE id_user = :user_id AND (status = 'active' OR status = 'end_of_time'  OR status = 'end_of_volume' OR status = 'sendedwarn' OR Status = 'send_on_hold') AND username = :username");
    $stmt->bindValue(':user_id', $user_id, PDO::PARAM_INT);
    $stmt->bindValue(':username', $username, PDO::PARAM_STR);
    $stmt->execute();
    $invoice = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($invoice) {
        $panel = select("marzban_panel", "*", "name_panel", $invoice['Service_location'], "select");
        if (!$panel) {
            http_response_code(404);
            echo json_encode([
                'status' => false,
                'msg' => "Panel Not Found",
                'obj' => []
            ]);
            return;
        }
        $DataUserOut = $ManagePanel->DataUser($invoice['Service_location'], $invoice['username']);
        if (!is_array($DataUserOut) || !array_key_exists('data_limit', $DataUserOut) || !array_key_exists('used_traffic', $DataUserOut)) {
            http_response_code(502);
            echo json_encode([
                'status' => false,
                'msg' => isset($DataUserOut['msg']) ? $DataUserOut['msg'] : "Service data unavailable",
                'obj' => []
            ]);
            return;
        }
        $data_limit_bytes = is_numeric($DataUserOut['data_limit']) ? (float) $DataUserOut['data_limit'] : 0;
        $used_traffic_bytes = is_numeric($DataUserOut['used_traffic']) ? (float) $DataUserOut['used_traffic'] : 0;
        $remaining_traffic_bytes = max($data_limit_bytes - $used_traffic_bytes, 0);
        $data_limit = $data_limit_bytes / pow(1024, 3);
        $used_Traffic = $used_traffic_bytes / pow(1024, 3);
        $remaining_traffic = $remaining_traffic_bytes / pow(1024, 3);
        $config = [];
        if (in_array($panel['type'], ['marzban', 'marzneshin', 'alireza_single', 'x-ui_single', 'hiddify'])) {
            if ($panel['sublink'] == "onsublink" && !empty($DataUserOut['subscription_url'])) {
                $config[] = [
                    'type' => "link",
                    'value' => $DataUserOut['subscription_url']
                ];
            }
            $user_links = $DataUserOut['links'] ?? ($DataUserOut['configs'] ?? null);
            if (is_array($user_links) && count($user_links) > 0) {
                $config[] = [
                    'type' => "config",
                    'value' => array_values($user_links)
                ];
            }
        } elseif ($panel['type'] == "WGDashboard") {
            $config[] = [
                'type' => "file",
                'value' => $DataUserOut['subscription_url'] ?? '',
                'filename' => $panel['inboundid'] . "_" . $invoice['id_user'] . "_" . $invoice['id_invoice'] . ".config"
            ];
        } elseif (in_array($panel['type'], ['mikrotik', 'ibsng'])) {
            $config[] = [
                'type' => "password",
                'value' => $DataUserOut['password'] ?? ''
            ];
        }
        if (isset($DataUserOut['sub_updated_at']) && $DataUserOut['sub_updated_at'] !== null) {
            $sub_updated = $DataUserOut['sub_updated_at'];
            $dateTime = new DateTime($sub_updated, new DateTimeZone('UTC'));
            $dateTime->setTimezone(new DateTimeZone('Asia/Tehran'));
            $lastupdate = jdate('Y/m/d H:i:s', $dateTime->getTimestamp());
        } else {
            $lastupdate = null;
        }
        if (($DataUserOut['online_at'] ?? null) == "online") {
            $lastonline = $textbotlang['common']['connection']['online'];
        } elseif (($DataUserOut['online_at'] ?? null) == "offline") {
            $lastonline = $textbotlang['common']['connection']['offline'];
        } else {
            if (isset($DataUserOut['online_at']) && $DataUserOut['online_at'] !== null) {
                $dateString = $DataUserOut['online_at'];
                $date = new DateTime($dateString, new DateTimeZone('UTC'));
                $date->setTimezone(new DateTimeZone('Asia/Tehran'));
                $lastonline = jdate('Y/m/d H:i:s', $date->getTimestamp());
            } else {
                $lastonline = $textbotlang['common']['connection']['notConnected'];
            }
        }
        $expireTimestamp = isset($DataUserOut['expire']) && is_numeric($DataUserOut['expire']) ? (int) $DataUserOut['expire'] : 0;
        $expirationDate = $expireTimestamp ? jdate('Y/m/d', $expireTimestamp) : $textbotlang['common']['labels']['unlimited'];
        $usernameOutput = $DataUserOut['username'] ?? $invoice['username'];
        echo json_encode([
            'status' => true,
            'msg' => "Successful",
            'obj' => array(
                'status' => $DataUserOut['status'],
                'username' => $usernameOutput,
                'product_name' => $invoice['name_product'],
                'total_traffic_gb' => round($data_limit, 2),
                'used_traffic_gb' => round($used_Traffic, 2),
                'remaining_traffic_gb' => round($remaining_traffic, 2),
                'expiration_time' => $expirationDate,
                'last_subscription_update' => $lastupdate,
                'online_at' => $lastonline,
                'service_output' => $config
            ),
        ]);
    } else {
        http_response_code(404);
        echo json_encode([
            'status' => false,
            'msg' => "Service Not  Found",
            'obj' => []
        ]);
    }
}

function mini_user_info(array $data, string $method): void
{
    global $pdo, $textbotlang, $tokencheck, $setting, $usernamebot;

    if ($method !== "GET") {
        echo json_encode([
            'status' => false,
            'msg' => "Method invalid; must be GET",
        ]);
        return;
    }
    $user_info = select("user", "*", "token", $tokencheck, "select");
    if ($user_info) {
        if ($user_info['codeInvitation'] == null) {
            $randomString = bin2hex(random_bytes(4));
            update("user", "codeInvitation", $randomString, "id", $user_info['id']);
            $user_info['codeInvitation'] = $randomString;
        }
        if ($user_info['number'] == "none") {
            $numberphone = $textbotlang['common']['labels']['receiptNotSent'];
        } else {
            $numberphone = $user_info['number'];
        }
        if ($user_info['number'] == "confrim number by admin") {
            $numberphone = $textbotlang['common']['labels']['confirmedByAdmin'];
        }
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM invoice WHERE id_user = :id_user AND name_product != :name_product AND (status = 'active' OR status = 'end_of_time'  OR status = 'end_of_volume' OR status = 'sendedwarn' OR Status = 'send_on_hold')");
        $stmt->bindValue(':name_product', $textbotlang['common']['labels']['testServiceName'], PDO::PARAM_STR);
        $stmt->bindValue(':id_user', $user_info['id'], PDO::PARAM_INT);
        $stmt->execute();
        $countorder = (int) $stmt->fetchColumn();
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM payment_report WHERE id_user = :from_id AND payment_Status = 'paid'");
        $stmt->execute([
            ':from_id' => $user_info['id']
        ]);
        $countpayment = (int) $stmt->fetchColumn();
        $groupuser = [
            'f' => $textbotlang['common']['roles']['normal'],
            'n' => $textbotlang['common']['roles']['agent'],
            'n2' => $textbotlang['common']['roles']['advancedAgent'],
        ][$user_info['agent']];
        $userjoin = jdate('Y/m/d', $user_info['register']);
        $affiliatesEnabled = check_active_btn($setting['keyboardmain'], "text_affiliates");
        echo json_encode([
            'status' => true,
            'msg' => "Successful",
            'obj' => [
                'codeInvitation' => $user_info['codeInvitation'],
                'balance' => $user_info['Balance'],
                'phone' => $numberphone,
                'count_order' => $countorder,
                'count_payment' => $countpayment,
                'group_type' => $groupuser,
                'time_join' => $userjoin,
                'affiliatescount' => $user_info['affiliatescount'],
                'affiliates_enabled' => $affiliatesEnabled,
                'invite_link' => $affiliatesEnabled ? "https://t.me/" . $usernamebot . "?start=" . $user_info['id'] : ''

            ]
        ]);
    } else {
        http_response_code(404);
        echo json_encode([
            'status' => false,
            'msg' => "User Not  Found",
        ]);
    }
}

function mini_countries(array $data, string $method): void
{
    global $pdo, $setting, $textbotlang, $tokencheck;

    if ($method !== "GET") {
        echo json_encode([
            'status' => false,
            'msg' => "Method invalid; must be GET",
        ]);
        return;
    }
    $user_info = select("user", "*", "token", $tokencheck, "select");
    if ($user_info) {
        $stmt = $pdo->prepare("SELECT * FROM marzban_panel WHERE status = 'active' AND (agent = :agent OR agent = 'all') AND type != 'Manualsale'");
        $stmt->bindParam(':agent', $user_info['agent']);
        $stmt->execute();
        $panel_list = [];
        $setting = config_all('setting');
        ;
        $is_note = false;
        if ($setting['statusnamecustom'] == 'onnamecustom')
            $is_note = true;
        if ($setting['statusnoteforf'] == "0" && $user_info['agent'] == "f")
            $is_note = false;
        while ($result = $stmt->fetch(PDO::FETCH_ASSOC)) {
            if (in_array(usernameMethodKey($result['MethodUsername']), ['customUsername', 'customUsernameRandom'], true)) {
                $is_username = true;
            } else {
                $is_username = false;
            }
            $statuscustomvolume = panelAgentValue($result['customvolume'], $user_info['agent']);
            if (intval($statuscustomvolume) == 1 && $result['type'] != "Manualsale") {
                $is_custom = true;
            } else {
                $is_custom = false;
            }
            $hidden_users = json_decode($result['hide_user'] ?? '', true);
            if (is_array($hidden_users) && in_array($user_info['id'], $hidden_users))
                continue;
            $panel_list[] = [
                'id' => $result['code_panel'],
                'name' => $result['name_panel'],
                'is_custom' => $is_custom,
                'is_username' => $is_username,
                'is_note' => $is_note
            ];
        }
        echo json_encode([
            'status' => true,
            'msg' => "Successful",
            'obj' => $panel_list
        ]);
    } else {
        http_response_code(404);
        echo json_encode([
            'status' => false,
            'msg' => "User Not  Found",
        ]);
    }
}

function mini_categories(array $data, string $method): void
{
    global $pdo, $setting, $tokencheck;

    if ($method !== "GET") {
        echo json_encode([
            'status' => false,
            'msg' => "Method invalid; must be GET",
        ]);
        return;
    }
    $user_info = select("user", "*", "token", $tokencheck, "select");
    if ($user_info) {
        $setting = config_all('setting');
        if ($setting['statuscategorygenral'] == "offcategorys") {
            echo json_encode(array(
                'status' => true,
                'msg' => "Successful",
                'obj' => []
            ));
            return;
        }
        $stmt = $pdo->prepare("SELECT * FROM category");
        $stmt->execute();
        $category_list = [];
        $panel = select("marzban_panel", "*", "code_panel", $data['id_panel'], "select");
        if (empty($panel)) {
            echo json_encode(array(
                'status' => false,
                'msg' => "panel not fonud!(invalid id_panel)"
            ));
            return;
        }
        while ($result = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $stmts = $pdo->prepare("SELECT * FROM product WHERE (Location = :location OR Location = '/all') AND category = :category AND agent = :agent");
            $stmts->bindParam(':location', $panel['name_panel'], PDO::PARAM_STR);
            $stmts->bindParam(':category', $result['remark'], PDO::PARAM_STR);
            $stmts->bindParam(':agent', $user_info['agent']);
            $stmts->execute();
            if ($stmts->rowCount() == 0)
                continue;
            $category_list[] = [
                'id' => $result['id'],
                'name' => $result['remark'],
            ];
        }
        echo json_encode([
            'status' => true,
            'msg' => "Successful",
            'obj' => $category_list
        ]);
    } else {
        http_response_code(404);
        echo json_encode([
            'status' => false,
            'msg' => "User Not  Found",
        ]);
    }
}

function mini_time_ranges(array $data, string $method): void
{
    global $pdo, $setting, $textbotlang, $tokencheck;

    if ($method !== "GET") {
        echo json_encode([
            'status' => false,
            'msg' => "Method invalid; must be GET",
        ]);
        return;
    }
    $user_info = select("user", "*", "token", $tokencheck, "select");
    if ($user_info) {
        $setting = config_all('setting');
        if ($setting['statuscategory'] == "offcategory") {
            echo json_encode(array(
                'status' => true,
                'msg' => "Successful",
                'obj' => []
            ));
            return;
        }
        $category_time_list = [];
        $panel = select("marzban_panel", "*", "code_panel", $data['id_panel'], "select");
        if (empty($panel)) {
            echo json_encode(array(
                'status' => false,
                'msg' => "panel not fonud!(invalid id_panel)"
            ));
            return;
        }
        $stmt = $pdo->prepare("SELECT (Service_time) FROM product WHERE (Location = :name_panel OR Location = '/all') AND  agent = :agent");
        $stmt->bindValue(':agent', $user_info['agent'], PDO::PARAM_STR);
        $stmt->bindValue(':name_panel', $panel['name_panel'], PDO::PARAM_STR);
        $stmt->execute();
        $montheproduct = array_flip(array_flip($stmt->fetchAll(PDO::FETCH_COLUMN)));
        if (in_array("1", $montheproduct)) {
            $category_time_list[] = array(
                'id' => 0,
                'name' => $textbotlang['common']['duration']['1day'],
                'day' => 1
            );
        }
        if (in_array("7", $montheproduct)) {
            $category_time_list[] = array(
                'id' => 0,
                'name' => $textbotlang['common']['duration']['7day'],
                'day' => 7
            );
        }
        if (in_array("31", $montheproduct)) {
            $category_time_list[] = array(
                'id' => 0,
                'name' => $textbotlang['common']['duration']['1'],
                'day' => 31
            );
        }
        if (in_array("30", $montheproduct)) {
            $category_time_list[] = array(
                'id' => 0,
                'name' => $textbotlang['common']['duration']['1'],
                'day' => 30
            );
        }
        if (in_array("61", $montheproduct)) {
            $category_time_list[] = array(
                'id' => 0,
                'name' => $textbotlang['common']['duration']['2'],
                'day' => 61
            );
        }
        if (in_array("60", $montheproduct)) {
            $category_time_list[] = array(
                'id' => 0,
                'name' => $textbotlang['common']['duration']['2'],
                'day' => 60
            );
        }
        if (in_array("91", $montheproduct)) {
            $category_time_list[] = array(
                'id' => 0,
                'name' => $textbotlang['common']['duration']['3'],
                'day' => 91
            );
        }
        if (in_array("90", $montheproduct)) {
            $category_time_list[] = array(
                'id' => 0,
                'name' => $textbotlang['common']['duration']['3'],
                'day' => 90
            );
        }
        if (in_array("121", $montheproduct)) {
            $category_time_list[] = array(
                'id' => 0,
                'name' => $textbotlang['common']['duration']['4'],
                'day' => 121
            );
        }
        if (in_array("120", $montheproduct)) {
            $category_time_list[] = array(
                'id' => 0,
                'name' => $textbotlang['common']['duration']['4'],
                'day' => 120
            );
        }
        if (in_array("181", $montheproduct)) {
            $category_time_list[] = array(
                'id' => 0,
                'name' => $textbotlang['common']['duration']['6'],
                'day' => 181
            );
        }
        if (in_array("180", $montheproduct)) {
            $category_time_list[] = array(
                'id' => 0,
                'name' => $textbotlang['common']['duration']['6'],
                'day' => 180
            );
        }
        if (in_array("365", $montheproduct)) {
            $category_time_list[] = array(
                'id' => 0,
                'name' => $textbotlang['common']['duration']['365'],
                'day' => 365
            );
        }
        if (in_array("0", $montheproduct)) {
            $category_time_list[] = array(
                'id' => 0,
                'name' => $textbotlang['common']['duration']['byVolume'],
                'day' => 0
            );
        }
        echo json_encode([
            'status' => true,
            'msg' => "Successful",
            'obj' => $category_time_list
        ]);
    } else {
        http_response_code(404);
        echo json_encode([
            'status' => false,
            'msg' => "User Not  Found",
        ]);
    }
}

function mini_services(array $data, string $method): void
{
    global $pdo, $tokencheck;

    if ($method !== "GET") {
        echo json_encode([
            'status' => false,
            'msg' => "Method invalid; must be GET",
        ]);
        return;
    }
    $product_list = [];
    $user_info = select("user", "*", "token", $tokencheck, "select");
    if ($user_info) {
        $panel = select("marzban_panel", "*", "code_panel", $data['id_panel'], "select");
        if (empty($panel)) {
            echo json_encode(array(
                'status' => false,
                'msg' => "panel not fonud!(invalid id_panel)"
            ));
            return;
        }
        $category_remark = null;
        $category_remarks = "";
        $queryParams = [':loc' => $panel['name_panel'], ':ag' => $user_info['agent']];
        $selected_category_id = isset($data['category_id']) ? $data['category_id'] : null;
        if (!empty($data['category_id'])) {
            $category_remark = select("category", "*", "id", $data['category_id'], "select");
            if (!is_array($category_remark) || !isset($category_remark['remark'])) {
                echo json_encode([
                    'status' => false,
                    'msg' => "category not found!(invalid category_id)",
                ]);
                return;
            }
            $category_remarks = "AND category = :catrem";
            $queryParams[':catrem'] = $category_remark['remark'];
            $selected_category_id = $category_remark['id'];
        }
        $time_range_day = "";
        if ($data['time_range_day'] != 0) {
            $time_range_day = "AND Service_time = :trd";
            $queryParams[':trd'] = $data['time_range_day'];
        }
        $stmt = $pdo->prepare("SELECT * FROM product WHERE (Location = :loc OR Location = '/all')AND agent= :ag $category_remarks $time_range_day");
        $stmt->execute($queryParams);
        $product_list = [];
        $countorder = null;
        while ($result = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $hide_panel = json_decode($result['hide_panel'], true);
            if (!is_array($hide_panel)) {
                $hide_panel = [];
            }
            if (in_array($panel['name_panel'], $hide_panel))
                continue;
            if ($result['one_buy_status'] == "1") {
                if ($countorder === null) {
                    $stmts2 = $pdo->prepare("SELECT COUNT(*) FROM invoice WHERE Status != 'Unpaid' AND id_user = :mp4");
                    $stmts2->execute([':mp4' => $user_info['id']]);
                    $countorder = (int) $stmts2->fetchColumn();
                }
                if ($countorder != 0)
                    continue;
            }
            if (intval($user_info['pricediscount']) != 0) {
                $resultper = ($result['price_product'] * $user_info['pricediscount']) / 100;
                $result['price_product'] = $result['price_product'] - $resultper;
            }
            $product_list[] = [
                'id' => $result['code_product'],
                'name' => $result['name_product'],
                'description' => $result['note'],
                'price' => $result['price_product'],
                'traffic_gb' => $result['Volume_constraint'],
                'time_days' => intval($result['Service_time']),
                'category_id' => $selected_category_id,
                'country_id' => $panel['code_panel'],
                'time_range_id' => $result['Service_time']

            ];
        }
        echo json_encode([
            'status' => true,
            'msg' => "Successful",
            'obj' => $product_list
        ]);
    } else {
        http_response_code(404);
        echo json_encode([
            'status' => false,
            'msg' => "User Not  Found",
        ]);
    }
}

function mini_custom_price(array $data, string $method): void
{
    global $tokencheck;

    if ($method !== "GET") {
        echo json_encode([
            'status' => false,
            'msg' => "Method invalid; must be GET",
        ]);
        return;
    }
    $user_info = select("user", "*", "token", $tokencheck, "select");
    if ($user_info) {
        $panel = select("marzban_panel", "*", "code_panel", $data['id_panel'], "select");
        if (empty($panel)) {
            echo json_encode(array(
                'status' => false,
                'msg' => "panel not fonud!(invalid id_panel)"
            ));
            return;
        }
        $agentKey = $user_info['agent'];
        $statuscustomvolume = panelAgentValue($panel['customvolume'], $agentKey);
        $mainvolume = panelAgentValue($panel['mainvolume'], $agentKey);
        $maxvolume = panelAgentValue($panel['maxvolume'], $agentKey);
        $maintime = panelAgentValue($panel['maintime'], $agentKey);
        $maxtime = panelAgentValue($panel['maxtime'], $agentKey);
        $traffic_price = panelAgentValue($panel['pricecustomvolume'], $agentKey);
        $time_price = panelAgentValue($panel['pricecustomtime'], $agentKey);
        if (intval($statuscustomvolume) == 1 && $panel['type'] != "Manualsale") {
            $price = ($traffic_price * intval($data['traffic_gb'])) + ($time_price * intval($data['time_days']));
        } else {
            $price = false;
        }
        echo json_encode([
            'status' => true,
            'msg' => "Successful",
            'obj' => array(
                'price' => $price,
                'traffic_min' => intval($mainvolume),
                'traffic_max' => intval($maxvolume),
                'time_min' => intval($maintime),
                'time_max' => intval($maxtime)
            )
        ]);
    } else {
        http_response_code(404);
        echo json_encode([
            'status' => false,
            'msg' => "User Not  Found",
        ]);
    }
}

function mini_purchase(array $data, string $method): void
{
    global $pdo, $setting, $textbotlang, $ManagePanel, $errorreport, $porsantreport, $buyreport, $usercheck;

    if ($method !== "POST") {
        echo json_encode([
            'status' => false,
            'msg' => "Method invalid; must be POST",
        ]);
        return;
    }
    if (!empty($data['custom_username']) && !preg_match('~(?!_)^[a-z][a-z\d_]{2,32}(?<!_)$~i', (string) $data['custom_username'])) {
        http_response_code(400);
        echo json_encode(array(
            'status' => false,
            'msg' => strip_tags($textbotlang['users']['invalidusername'])
        ));
        return;
    }
    $panel = select("marzban_panel", "*", "code_panel", $data['country_id'] ?? '', "select");
    if (empty($panel)) {
        http_response_code(500);
        echo json_encode(array(
            'status' => false,
            'msg' => $textbotlang['users']['sell']['panelMissing']
        ));
        return;
    }
    if ($panel['status'] == "disable") {
        http_response_code(500);
        echo json_encode(array(
            'status' => false,
            'msg' => $textbotlang['users']['sell']['panelInactive']
        ));
        return;
    }
    $needsUsername = in_array(usernameMethodKey($panel['MethodUsername']), ['customUsername', 'customUsernameRandom'], true);
    $customUsername = isset($data['custom_username']) && is_string($data['custom_username']) ? trim($data['custom_username']) : '';
    if ($needsUsername && $customUsername === '') {
        http_response_code(400);
        echo json_encode(array(
            'status' => false,
            'msg' => $textbotlang['users']['selectusername'] ?? 'لطفاً نام کاربری دلخواه را وارد کنید.'
        ));
        return;
    }
    $user_info = $usercheck;
    if (empty($data['custom_service'])) {
        $product = select("product", "*", "code_product", $data['service_id'] ?? '', "select");
        if (!empty($product)) {
            $productLocation = $product['Location'] ?? '';
            $allowedLocation = ($productLocation === $panel['name_panel'] || $productLocation === '/all');
            $hide_panel = json_decode($product['hide_panel'] ?? '', true);
            if (!is_array($hide_panel)) {
                $hide_panel = [];
            }
            $blocked = !$allowedLocation
                || ($product['agent'] ?? null) !== $user_info['agent']
                || in_array($panel['name_panel'], $hide_panel);
            if (!$blocked && ($product['one_buy_status'] ?? null) == "1") {
                $stmtOneBuy = $pdo->prepare("SELECT COUNT(*) FROM invoice WHERE Status != 'Unpaid' AND id_user = :uid");
                $stmtOneBuy->execute([':uid' => $user_info['id']]);
                if ((int) $stmtOneBuy->fetchColumn() != 0) {
                    $blocked = true;
                }
            }
            if ($blocked) {
                http_response_code(403);
                echo json_encode(array(
                    'status' => false,
                    'msg' => $textbotlang['users']['sell']['productNotFound']
                ));
                return;
            }
        }
    } else {
        $agentKey = $user_info['agent'];
        if (intval(panelAgentValue($panel['customvolume'], $agentKey)) !== 1 || $panel['type'] == "Manualsale") {
            http_response_code(403);
            echo json_encode(array(
                'status' => false,
                'msg' => $textbotlang['users']['sell']['invalidVolumeRestart']
            ));
            return;
        }
        $mainvolume = panelAgentValue($panel['mainvolume'], $agentKey);
        $maxvolume = panelAgentValue($panel['maxvolume'], $agentKey);
        $maintime = panelAgentValue($panel['maintime'], $agentKey);
        $maxtime = panelAgentValue($panel['maxtime'], $agentKey);
        $custompricevalue = panelAgentValue($panel['pricecustomvolume'], $agentKey);
        $customtimevalueprice = panelAgentValue($panel['pricecustomtime'], $agentKey);
        $customsrvice = $data['custom_service'];
        if (!is_array($customsrvice) || !isset($customsrvice['traffic_gb'], $customsrvice['time_days'])
            || !is_numeric($customsrvice['traffic_gb']) || !is_numeric($customsrvice['time_days'])) {
            http_response_code(500);
            echo json_encode(array(
                'status' => false,
                'msg' => $textbotlang['users']['sell']['invalidVolumeRestart']
            ));
            return;
        }
        $product = array(
            'code_product' => "customvolume",
            'name_product' => $textbotlang['users']['customSellVolume']['title'],
            'Volume_constraint' => (int) $customsrvice['traffic_gb'],
            'Service_time' => (int) $customsrvice['time_days'],
            'Location' => $panel['name_panel'],
            'category' => null,
            'price_product' => ((int) $customsrvice['traffic_gb'] * $custompricevalue) + ((int) $customsrvice['time_days'] * $customtimevalueprice)
        );
        if (intval($product['Volume_constraint']) > $maxvolume or intval($product['Volume_constraint']) < $mainvolume) {
            http_response_code(500);
            echo json_encode(array(
                'status' => false,
                'msg' => $textbotlang['users']['sell']['invalidVolumeRestart']
            ));
            return;
        }
        if (intval($product['Service_time']) > $maxtime or intval($product['Service_time']) < $maintime) {
            http_response_code(500);
            echo json_encode(array(
                'status' => false,
                'msg' => $textbotlang['users']['sell']['invalidTimeRestart']
            ));
            return;
        }
        if ($product['price_product'] <= 0) {
            http_response_code(403);
            echo json_encode(array(
                'status' => false,
                'msg' => $textbotlang['users']['sell']['invalidVolumeRestart']
            ));
            return;
        }
    }
    if (empty($product)) {
        http_response_code(500);
        echo json_encode(array(
            'status' => false,
            'msg' => $textbotlang['users']['sell']['productNotFound']
        ));
        return;
    }
    if (intval($user_info['pricediscount']) != 0) {
        $result = ($product['price_product'] * $user_info['pricediscount']) / 100;
        $product['price_product'] = $product['price_product'] - $result;
        sendmessage($user_info['id'], sprintf($textbotlang['users']['Discount']['discountapplied'], $user_info['pricediscount']), null, 'HTML');
    }
    $price_product = $product['price_product'];

    $directSettingRow = ['value' => config_get('shop', 'statusdirectpabuy')];
    $directSetting = is_array($directSettingRow) ? $directSettingRow['value'] : '';
    if ($price_product > 0 && $user_info['agent'] != "n2" && (float) $user_info['Balance'] < $price_product) {
        $directMethods = $directSetting === "offdirectbuy" ? array() : mini_wallet_methods($user_info);
        if ($directSetting === "offdirectbuy" || !$directMethods) {
            http_response_code(500);
            echo json_encode(array(
                'status' => false,
                'msg' => $textbotlang['users']['Balance']['lessThanPrice']
            ));
            return;
        }
        try {
            $randomString = bin2hex(random_bytes(4));
            $username_ac = generateUsername($user_info['id'], $panel['MethodUsername'], $user_info['username'], $randomString, $customUsername !== '' ? $customUsername : null, $panel['namecustom'], $user_info['namecustom']);
            $username_ac = strtolower($username_ac);
            $DataUserOut = $ManagePanel->DataUser($panel['name_panel'], $username_ac);
            if (isset($DataUserOut['username']) || rowExists("invoice", "username", $username_ac)) {
                http_response_code(500);
                echo json_encode(array(
                    'status' => false,
                    'msg' => $textbotlang['users']['sell']['usernameExists']
                ));
                return;
            }
            $notifctions = json_encode(array(
                'volume' => false,
                'time' => false,
            ));
            $stmt = $pdo->prepare("INSERT IGNORE INTO invoice (id_user, id_invoice, username,time_sell, Service_location, name_product, price_product, Volume, Service_time,Status,note,refral,notifctions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            $custom_note = isset($data['custom_note']) && strlen(strval($data['custom_note'])) > 1 ? $data['custom_note'] : null;
            $stmt->execute([$user_info['id'], $randomString, $username_ac, time(), $panel['name_panel'], $product['name_product'], $price_product, $product['Volume_constraint'], $product['Service_time'], "unpaid", $custom_note, $user_info['affiliates'], $notifctions]);
            if ($stmt->rowCount() === 0) {
                http_response_code(500);
                echo json_encode(array(
                    'status' => false,
                    'msg' => $textbotlang['users']['sell']['usernameExists']
                ));
                return;
            }
        } catch (Throwable $e) {
            error_log("Direct purchase invoice failed for user {$user_info['id']}: " . $e->getMessage());
            http_response_code(500);
            echo json_encode(array(
                'status' => false,
                'msg' => $textbotlang['users']['sell']['subscriptionError']
            ));
            return;
        }
        echo json_encode(array(
            'success' => true,
            'requires_payment' => true,
            'message' => "payment_required",
            'order_id' => $randomString,
            'service' => array(
                'id' => $randomString,
                'username' => $username_ac,
                'status' => 'unpaid',
            ),
            'payment' => array(
                'amount' => (int) round($price_product - (float) $user_info['Balance']),
                'price' => (int) round($price_product),
                'balance' => (int) $user_info['Balance'],
                'username' => $username_ac,
                'methods' => $directMethods,
            ),
        ));
        return;
    }

    $charged = false;
    if ($price_product > 0) {
        if ($user_info['agent'] == "n2") {
            $min_balance = intval($user_info['maxbuyagent']) != 0 ? -intval($user_info['maxbuyagent']) : PHP_INT_MIN;
            $error_msg = $textbotlang['users']['Balance']['maxpurchasereached'];
        } else {
            $min_balance = 0;
            $error_msg = $textbotlang['users']['Balance']['lessThanPrice'];
        }
        $stmt = $pdo->prepare("UPDATE user SET Balance = Balance - :price WHERE id = :id AND Balance - :price_check >= :min_balance");
        $stmt->execute([':price' => $price_product, ':id' => $user_info['id'], ':price_check' => $price_product, ':min_balance' => $min_balance]);
        if ($stmt->rowCount() === 0) {
            http_response_code(500);
            echo json_encode(array(
                'status' => false,
                'msg' => $error_msg
            ));
            return;
        }
        $charged = true;
    }

    $randomString = bin2hex(random_bytes(4));

    $rolledBack = false;
    $refundOnFailure = function () use ($pdo, $user_info, $price_product, $randomString, &$charged, &$rolledBack) {
        if ($rolledBack) {
            return;
        }
        $rolledBack = true;

        try {
            $stmt = $pdo->prepare("DELETE FROM invoice WHERE id_invoice = :id_invoice");
            $stmt->execute([':id_invoice' => $randomString]);
        } catch (Exception $e) {
            error_log("Failed to roll back invoice {$randomString}: " . $e->getMessage());
        }

        if (!$charged) {
            return;
        }

        try {
            $stmt = $pdo->prepare("UPDATE user SET Balance = Balance + :price WHERE id = :id");
            $stmt->execute([':price' => $price_product, ':id' => $user_info['id']]);
            $charged = false;
        } catch (Exception $e) {
            error_log("Failed to refund user {$user_info['id']}: " . $e->getMessage());
        }
    };

    try {
        $username_ac = generateUsername($user_info['id'], $panel['MethodUsername'], $user_info['username'], $randomString, $customUsername !== '' ? $customUsername : null, $panel['namecustom'], $user_info['namecustom']);
        $username_ac = strtolower($username_ac);
        $DataUserOut = $ManagePanel->DataUser($panel['name_panel'], $username_ac);
        if (isset($DataUserOut['username']) || rowExists("invoice", "username", $username_ac)) {
            $refundOnFailure();
            http_response_code(500);
            echo json_encode(array(
                'status' => false,
                'msg' => $textbotlang['users']['sell']['usernameExists']
            ));
            return;
        }
        $notifctions = json_encode(array(
            'volume' => false,
            'time' => false,
        ));
        $stmt = $pdo->prepare("INSERT IGNORE INTO invoice (id_user, id_invoice, username,time_sell, Service_location, name_product, price_product, Volume, Service_time,Status,note,refral,notifctions) VALUES (?, ?, ?, ?, ?, ?, ?, ?,?,?,?,?,?)");
        $Status = "active";
        $date = time();
        $custom_note = isset($data['custom_note']) && strlen(strval($data['custom_note'])) > 1 ? $data['custom_note'] : null;
        $stmt->execute([$user_info['id'], $randomString, $username_ac, $date, $panel['name_panel'], $product['name_product'], $price_product, $product['Volume_constraint'], $product['Service_time'], $Status, $custom_note, $user_info['affiliates'], $notifctions]);
        $datetimestep = strtotime("+" . $product['Service_time'] . "days");
        if ($product['Service_time'] == 0) {
            $datetimestep = 0;
        } else {
            $datetimestep = strtotime(date("Y-m-d H:i:s", $datetimestep));
        }
        $datac = array(
            'expire' => $datetimestep,
            'data_limit' => $product['Volume_constraint'] * pow(1024, 3),
            'from_id' => $user_info['id'],
            'username' => $user_info['username'],
            'type' => 'buy'
        );
        $dataoutput = $ManagePanel->createUser($panel['name_panel'], $product['code_product'], $username_ac, $datac);
        if (!is_array($dataoutput) || ($dataoutput['username'] ?? null) == null) {
            $refundOnFailure();

            http_response_code(500);
            echo json_encode(array(
                'status' => false,
                'msg' => $textbotlang['users']['sell']['subscriptionError']
            ));

            $errorDetail = json_encode(is_array($dataoutput) ? ($dataoutput['msg'] ?? null) : null);
            $texterros = sprintf($textbotlang['Admin']['reportgroup']['errorSubscriptionCreateAdmin'], $errorDetail, $user_info['id'], $user_info['username'], $panel['name_panel']);
            sendReport($texterros, $setting['Channel_Report'], $errorreport);
            return;
        }
    } catch (Throwable $e) {
        error_log("Purchase failed for user {$user_info['id']}: " . $e->getMessage());
        $refundOnFailure();

        http_response_code(500);
        echo json_encode(array(
            'status' => false,
            'msg' => $textbotlang['users']['sell']['subscriptionError']
        ));
        return;
    }

    $config = "";
    $output_config_link = $panel['sublink'] == "onsublink" ? ($dataoutput['subscription_url'] ?? "") : "";
    if ($panel['config'] == "onconfig" && is_array($dataoutput['configs'] ?? null)) {
        foreach ($dataoutput['configs'] as $link) {
            $config .= "\n" . $link;
        }
    }
    $textbotlang['textbot']['afterPay'] = $panel['type'] == "Manualsale" ? $textbotlang['textbot']['manual'] : $textbotlang['textbot']['afterPay'];
    $textbotlang['textbot']['afterPay'] = $panel['type'] == "WGDashboard" ? $textbotlang['textbot']['wgDashboard'] : $textbotlang['textbot']['afterPay'];
    $textbotlang['textbot']['afterPay'] = $panel['type'] == "ibsng" || $panel['type'] == "mikrotik" ? $textbotlang['textbot']['afterPayIbsng'] : $textbotlang['textbot']['afterPay'];
    if (intval($product['Service_time']) == 0)
        $product['Service_time'] = $textbotlang['users']['status']['unlimited'];
    if (intval($product['Volume_constraint']) == 0)
        $product['Volume_constraint'] = $textbotlang['users']['status']['unlimited'];
    $textcreatuser = str_replace('{username}', "<code>{$dataoutput['username']}</code>", $textbotlang['textbot']['afterPay']);
    $textcreatuser = str_replace('{name_service}', $product['name_product'], $textcreatuser);
    $textcreatuser = str_replace('{location}', $panel['name_panel'], $textcreatuser);
    $textcreatuser = str_replace('{day}', $product['Service_time'], $textcreatuser);
    $textcreatuser = str_replace('{volume}', $product['Volume_constraint'], $textcreatuser);
    $textcreatuser = str_replace('{config}', "<code>{$output_config_link}</code>", $textcreatuser);
    $textcreatuser = str_replace('{links}', $config, $textcreatuser);
    $textcreatuser = str_replace('{links2}', $output_config_link, $textcreatuser);
    sendMessageService($panel, $dataoutput['configs'] ?? null, $output_config_link, $user_info['username'], null, $textcreatuser, $randomString, $user_info['id'], __DIR__ . '/../images.jpg');
    if (in_array(usernameMethodKey($panel['MethodUsername']), ['customTextSequential', 'usernameSequential', 'numericIdSequential', 'agentCustomTextSequential'], true)) {
        $value = intval($user_info['number_username']) + 1;
        update("user", "number_username", $value, "id", $user_info['id']);
        if (in_array(usernameMethodKey($panel['MethodUsername']), ['customTextSequential', 'agentCustomTextSequential'], true)) {
            $value = intval($setting['numbercount']) + 1;
            config_set('setting', 'numbercount', (string) $value);
        }
    }
    $affiliatescommission = select("affiliates", "*", null, null, "select");
    $marzbanporsant_one_buy = select("affiliates", "*", null, null, "select");
    $stmt = $pdo->prepare("SELECT COUNT(*) FROM invoice WHERE name_product != :name_product AND id_user = :id_user");
    $stmt->bindParam(':id_user', $user_info['id']);
    $stmt->bindParam(':name_product', $textbotlang['common']['labels']['testServiceName']);
    $stmt->execute();
    $countinvoice = (int) $stmt->fetchColumn();
    if ($affiliatescommission['status_commission'] == "oncommission" && ($user_info['affiliates'] != null && intval($user_info['affiliates']) != 0)) {
        if ($marzbanporsant_one_buy['porsant_one_buy'] == "on_buy_porsant") {
            if ($countinvoice == 1) {
                $result = ($product['price_product'] * $setting['affiliatespercentage']) / 100;
                $user_Balance = select("user", "*", "id", $user_info['affiliates'], "select");
                $Balance_prim = $user_Balance['Balance'] + $result;
                if (intval($setting['scorestatus']) == 1) {
                    sendmessage($user_info['affiliates'], $textbotlang['users']['affiliates']['pointsEarned2'], null, 'html');
                    $scorenew = $user_Balance['score'] + 2;
                    update("user", "score", $scorenew, "id", $user_info['affiliates']);
                }
                update("user", "Balance", $Balance_prim, "id", $user_info['affiliates']);
                $result = number_format($result);
                $dateacc = date('Y/m/d H:i:s');
                $textadd = sprintf($textbotlang['users']['affiliates']['commissionPaidMiniapp'], $result);
                $textreportport = sprintf($textbotlang['Admin']['reportgroup']['commissionPaidMiniapp'], $result, $user_info['affiliates'], $user_info['id'], $dateacc);
                if (strlen($setting['Channel_Report']) > 0) {
                    telegram('sendmessage', [
                        'chat_id' => $setting['Channel_Report'],
                        'message_thread_id' => $porsantreport,
                        'text' => $textreportport,
                        'parse_mode' => "HTML"
                    ]);
                }
                sendmessage($user_info['affiliates'], $textadd, null, 'HTML');
            } else {

                $result = ($product['price_product'] * $setting['affiliatespercentage']) / 100;
                $user_Balance = select("user", "*", "id", $user_info['affiliates'], "select");
                $Balance_prim = $user_Balance['Balance'] + $result;
                if (intval($setting['scorestatus']) == 1) {
                    sendmessage($user_info['affiliates'], $textbotlang['users']['affiliates']['pointsEarned2b'], null, 'html');
                    $scorenew = $user_Balance['score'] + 2;
                    update("user", "score", $scorenew, "id", $user_info['affiliates']);
                }
                update("user", "Balance", $Balance_prim, "id", $user_info['affiliates']);
                $result = number_format($result);
                $dateacc = date('Y/m/d H:i:s');
                $textadd = sprintf($textbotlang['users']['affiliates']['commissionPaidMiniapp2'], $result);
                $textreportport = sprintf($textbotlang['Admin']['reportgroup']['commissionPaidMiniapp2'], $result, $user_info['affiliates'], $user_info['id'], $dateacc);
                if (strlen($setting['Channel_Report']) > 0) {
                    telegram('sendmessage', [
                        'chat_id' => $setting['Channel_Report'],
                        'message_thread_id' => $porsantreport,
                        'text' => $textreportport,
                        'parse_mode' => "HTML"
                    ]);
                }
                sendmessage($user_info['affiliates'], $textadd, null, 'HTML');
            }
        }
    }
    if (intval($setting['scorestatus']) == 1) {
        sendmessage($user_info['id'], $textbotlang['users']['affiliates']['pointsEarned1'], null, 'html');
        $scorenew = $user_info['score'] + 1;
        update("user", "score", $scorenew, "id", $user_info['id']);
    }
    $balanceformatsell = number_format(select("user", "Balance", "id", $user_info['id'], "select")['Balance'], 0);
    $textonebuy = "";
    if ($countinvoice == 1) {
        $textonebuy = $textbotlang['common']['labels']['firstPurchase'];
    }
    $balanceformatsellbefore = number_format($user_info['Balance'], 0);
    $Response = json_encode([
        'inline_keyboard' => [
            [
                ['text' => $textbotlang['Admin']['manageUser']['manageUserBtn'], 'callback_data' => 'manageuser_' . $user_info['id']],
            ],
        ]
    ]);
    $timejalali = jdate('Y/m/d H:i:s');
    $text_report = sprintf($textbotlang['Admin']['reportgroup']['accountCreatedMiniapp'], $textonebuy, $user_info['id'], $user_info['username'], $username_ac, $panel['name_panel'], $product['name_product'], $product['Service_time'], $product['Volume_constraint'], $balanceformatsellbefore, $balanceformatsell, $randomString, $user_info['agent'], $user_info['number'], $product['category'], $product['price_product'], $timejalali);
    if (strlen($setting['Channel_Report']) > 0) {
        telegram('sendmessage', [
            'chat_id' => $setting['Channel_Report'],
            'message_thread_id' => $buyreport,
            'text' => $text_report,
            'parse_mode' => "HTML",
            'reply_markup' => $Response
        ]);
    }
    echo json_encode(array(
        'success' => true,
        "message" => "ok",
        "order_id" => $randomString,
        "service" => array(
            'id' => $randomString,
            "username" => $username_ac,
            "status" => "active",
            "expire" => $datetimestep,
            "subscription_url" => $output_config_link,
            "configs" => is_array($dataoutput['configs'] ?? null) ? array_values($dataoutput['configs']) : array(),
            "password" => $dataoutput['subscription_url'] ?? '',
            "type" => $panel['type'],
        )
    ));
}

function mini_app_config(array $data, string $method): void
{
    global $usernamebot, $setting;

    if ($method !== "GET") {
        echo json_encode([
            'status' => false,
            'msg' => "Method invalid; must be GET",
        ]);
        return;
    }
    echo json_encode([
        'status' => true,
        'msg' => "Successful",
        'obj' => [
            'bot_username' => $usernamebot,
            'affiliates_enabled' => check_active_btn($setting['keyboardmain'], "text_affiliates"),
        ],
    ]);
}

function mini_pay_range($name, $agent, $default = 0)
{
    $raw = (string) getPaySettingValue($name, '');
    $decoded = json_decode($raw, true);
    if (is_array($decoded)) {
        return isset($decoded[$agent]) ? intval($decoded[$agent]) : $default;
    }
    return $raw === '' ? $default : intval($raw);
}

function mini_wallet_methods($user)
{
    $agent = $user['agent'];
    $globalMin = mini_pay_range('minbalance', $agent);
    $globalMax = mini_pay_range('maxbalance', $agent);
    $methods = [];
    $push = function ($id, $label, $minKey, $maxKey) use (&$methods, $agent, $globalMin, $globalMax) {
        $min = max($globalMin, mini_pay_range($minKey, $agent), 5000);
        $methodMax = mini_pay_range($maxKey, $agent);
        $max = $globalMax > 0 ? ($methodMax > 0 ? min($globalMax, $methodMax) : $globalMax) : $methodMax;
        if ($max > 0 && $max < $min) {
            return;
        }
        $methods[] = ['id' => $id, 'label' => $label, 'min' => $min, 'max' => $max];
    };
    if (trim((string) getPaySettingValue('zarinpalstatus', '')) === 'onzarinpal') {
        $push('zarinpal', 'زرین‌پال', 'minbalancezarinpal', 'maxbalancezarinpal');
    }
    if (trim((string) getPaySettingValue('statusaqayepardakht', '')) === 'onaqayepardakht') {
        $push('aqayepardakht', 'آقای پرداخت', 'minbalanceaqayepardakht', 'maxbalanceaqayepardakht');
    }
    $varizaToken = trim((string) getPaySettingValue('variza_api_token', ''));
    $varizaSecret = trim((string) getPaySettingValue('variza_webhook_secret', ''));
    if (trim((string) getPaySettingValue('variza_status', 'offvariza')) === 'onvariza' && $varizaToken !== '' && $varizaToken !== '0' && $varizaSecret !== '' && $varizaSecret !== '0') {
        $push('variza', 'وریزا', 'minbalancevariza', 'maxbalancevariza');
    }
    $cartStatus = trim((string) getPaySettingValue('Cartstatus', ''));
    if ($cartStatus === 'oncard' && intval($user['cardpayment']) == 1) {
        $cartMin = mini_pay_range('minbalancecart', $agent);
        $cartMax = mini_pay_range('maxbalancecart', $agent);
        if ($cartMin <= 0) {
            $cartMin = 10000;
        }
        if ($cartMax <= 0 || $cartMax >= $cartMin) {
            $methods[] = ['id' => 'cart', 'label' => 'کارت به کارت', 'min' => $cartMin, 'max' => $cartMax];
        }
    }
    return $methods;
}

function mini_wallet_info(array $data, string $method): void
{
    global $setting, $usercheck;

    if ($method !== "GET") {
        echo json_encode([
            'status' => false,
            'msg' => "Method invalid; must be GET",
        ]);
        return;
    }
    $debt = 0;
    if (intval($setting['Debtsettlement']) == 1 && intval($usercheck['Balance']) < 0) {
        $debt = abs(intval($usercheck['Balance']));
    }
    echo json_encode([
        'status' => true,
        'msg' => "Successful",
        'obj' => [
            'balance' => intval($usercheck['Balance']),
            'debt' => $debt,
            'methods' => mini_wallet_methods($usercheck),
        ],
    ]);
}

function mini_wallet_topup(array $data, string $method): void
{
    global $pdo, $setting, $textbotlang, $usercheck, $usernamebot;

    if ($method !== "POST") {
        echo json_encode([
            'status' => false,
            'msg' => "Method invalid; must be POST",
        ]);
        return;
    }
    $price = isset($data['price']) && is_numeric($data['price']) ? intval($data['price']) : 0;
    $gateway = isset($data['method']) && is_string($data['method']) ? $data['method'] : '';
    $methods = [];
    foreach (mini_wallet_methods($usercheck) as $item) {
        $methods[$item['id']] = $item;
    }
    if (!isset($methods[$gateway])) {
        http_response_code(400);
        echo json_encode([
            'status' => false,
            'msg' => $textbotlang['users']['Balance']['selectPayment'] ?? 'روش پرداخت نامعتبر است',
        ]);
        return;
    }
    $range = $methods[$gateway];
    $min = $range['min'];
    if (intval($setting['Debtsettlement']) == 1 && intval($usercheck['Balance']) < 0) {
        $min = max($min, abs(intval($usercheck['Balance'])));
    }
    if ($price < $min || ($range['max'] > 0 && $price > $range['max'])) {
        http_response_code(400);
        $rangeError = $range['max'] > 0
            ? sprintf($textbotlang['users']['Balance']['amountRangeError'] ?? 'مبلغ باید بین %s تا %s تومان باشد', number_format($min), number_format($range['max']))
            : sprintf('مبلغ باید حداقل %s تومان باشد', number_format($min));
        echo json_encode([
            'status' => false,
            'msg' => $rangeError,
        ]);
        return;
    }
    $order_id = bin2hex(random_bytes(5));
    $dateacc = date('Y/m/d H:i:s');
    $errorText = $textbotlang['users']['Balance']['errorLinkPayment'] ?? 'خطا در ایجاد لینک پرداخت';
    try {
        if ($gateway === 'zarinpal') {
            $pay = createPayZarinpal($price, $order_id);
            if (!is_array($pay) || ($pay['data']['code'] ?? null) != 100 || empty($pay['data']['authority'])) {
                throw new RuntimeException('zarinpal link');
            }
            $stmt = $pdo->prepare("INSERT INTO payment_report (id_user,id_order,time,price,payment_Status,Payment_Method,id_invoice,dec_not_confirmed) VALUES (?,?,?,?,?,?,?,?)");
            $stmt->execute([$usercheck['id'], $order_id, $dateacc, $price, 'Unpaid', 'zarinpal', '0|0', $pay['data']['authority']]);
            $url = "https://www.zarinpal.com/pg/StartPay/" . $pay['data']['authority'];
        } elseif ($gateway === 'aqayepardakht') {
            $pay = createPayaqayepardakht($price, $order_id);
            if (!is_array($pay) || ($pay['status'] ?? '') !== 'success' || empty($pay['transid'])) {
                throw new RuntimeException('aqayepardakht link');
            }
            $stmt = $pdo->prepare("INSERT INTO payment_report (id_user,id_order,time,price,payment_Status,Payment_Method,id_invoice) VALUES (?,?,?,?,?,?,?)");
            $stmt->execute([$usercheck['id'], $order_id, $dateacc, $price, 'Unpaid', 'aqayepardakht', '0|0']);
            $url = "https://panel.aqayepardakht.ir/startpay/" . $pay['transid'];
        } elseif ($gateway === 'cart') {
            if (trim((string) getPaySettingValue('Cartstatuspv', '')) === 'oncardpv') {
                $cartDirect = ltrim(trim((string) getPaySettingValue('CartDirect', '')), '@');
                if ($cartDirect === '' || $cartDirect === '0') {
                    throw new RuntimeException('cart agent not set');
                }
                echo json_encode([
                    'status' => true,
                    'msg' => "Successful",
                    'obj' => [
                        'type' => 'redirect',
                        'price' => $price,
                        'url' => 'https://t.me/' . $cartDirect,
                    ],
                ]);
                return;
            }
            $cardQuery = $pdo->query("SELECT * FROM card_number ORDER BY RAND() LIMIT 1");
            $card = $cardQuery ? $cardQuery->fetch(PDO::FETCH_ASSOC) : false;
            if (!$card || empty($card['cardnumber']) || empty($card['namecard'])) {
                throw new RuntimeException('no active card');
            }
            $stmt = $pdo->prepare("INSERT INTO payment_report (id_user,id_order,time,price,payment_Status,Payment_Method,id_invoice) VALUES (?,?,?,?,?,?,?)");
            $stmt->execute([$usercheck['id'], $order_id, $dateacc, $price, 'Unpaid', 'cart to cart', '0|0']);
            $replacements = [
                '{price}' => number_format($price),
                '{card_number}' => $card['cardnumber'],
                '{name_card}' => $card['namecard'],
            ];
            $buttons = [];
            if ($setting['statuscopycart'] == "1") {
                $buttons[] = [
                    ['text' => $textbotlang['keyboard']['copyCardNumber'], 'copy_text' => ['text' => $card['cardnumber']]],
                    ['text' => $textbotlang['keyboard']['copyAmount'], 'copy_text' => ['text' => $price . "0"]],
                ];
            }
            $buttons[] = [
                ['text' => $textbotlang['keyboard']['paidSendReceipt'], 'callback_data' => 'sendresidcart-' . $order_id],
            ];
            $message_id = telegram('sendmessage', [
                'chat_id' => $usercheck['id'],
                'text' => strtr($textbotlang['textbot']['cart'], $replacements),
                'reply_markup' => json_encode(['inline_keyboard' => $buttons]),
                'parse_mode' => "HTML",
            ]);
            updatePaymentMessageId($message_id, $order_id);
            echo json_encode([
                'status' => true,
                'msg' => "Successful",
                'obj' => [
                    'type' => 'cart',
                    'order_id' => $order_id,
                    'price' => $price,
                    'card_number' => $card['cardnumber'],
                    'name_card' => $card['namecard'],
                    'bot_username' => $usernamebot,
                ],
            ]);
            return;
        } elseif ($gateway === 'variza') {
            $pay = createPayVariza($price, $order_id);
            if (!is_array($pay) || empty($pay['pay_url'])) {
                throw new RuntimeException('variza link');
            }
            $stmt = $pdo->prepare("INSERT INTO payment_report (id_user,id_order,time,price,payment_Status,Payment_Method,id_invoice,dec_not_confirmed) VALUES (?,?,?,?,?,?,?,?)");
            $stmt->execute([$usercheck['id'], $order_id, $dateacc, $price, 'Unpaid', 'variza', '0|0', $pay['slug'] ?? $order_id]);
            $url = $pay['pay_url'];
        } else {
            throw new RuntimeException('gateway not supported');
        }
    } catch (Throwable $e) {
        error_log("Mini app wallet topup failed for user {$usercheck['id']}: " . $e->getMessage());
        http_response_code(502);
        echo json_encode([
            'status' => false,
            'msg' => $errorText,
        ]);
        return;
    }
    echo json_encode([
        'status' => true,
        'msg' => "Successful",
        'obj' => [
            'order_id' => $order_id,
            'price' => $price,
            'url' => $url,
        ],
    ]);
}

function mini_wallet_receipt(array $data, string $method): void
{
    global $pdo, $textbotlang, $usercheck;

    if ($method !== "POST") {
        echo json_encode([
            'status' => false,
            'msg' => "Method invalid; must be POST",
        ]);
        return;
    }
    $orderId = isset($data['order_id']) && is_string($data['order_id']) ? trim($data['order_id']) : '';
    $image = isset($data['image']) && is_string($data['image']) ? $data['image'] : '';
    $payment = $orderId !== '' ? select("payment_report", "*", "id_order", $orderId, "select") : null;
    if (!is_array($payment) || (string) $payment['id_user'] !== (string) $usercheck['id'] || $payment['Payment_Method'] !== 'cart to cart') {
        http_response_code(404);
        echo json_encode([
            'status' => false,
            'msg' => "پرداخت موردنظر یافت نشد.",
        ]);
        return;
    }
    if ($payment['payment_Status'] === 'paid') {
        http_response_code(409);
        echo json_encode([
            'status' => false,
            'msg' => $textbotlang['users']['Balance']['alreadyConfirmed'] ?? 'این پرداخت قبلاً تأیید شده است.',
        ]);
        return;
    }
    if ($payment['payment_Status'] === 'expire') {
        http_response_code(409);
        echo json_encode([
            'status' => false,
            'msg' => $textbotlang['users']['Balance']['transactionExpired'] ?? 'این تراکنش منقضی شده است.',
        ]);
        return;
    }
    if (!preg_match('~^data:image/(jpe?g|png|webp);base64,([A-Za-z0-9+/=\s]+)$~i', $image, $match)) {
        http_response_code(400);
        echo json_encode([
            'status' => false,
            'msg' => $textbotlang['users']['Balance']['onlyOneImage'] ?? 'لطفاً یک تصویر رسید ارسال کنید.',
        ]);
        return;
    }
    $binary = base64_decode(preg_replace('/\s+/', '', $match[2]), true);
    if ($binary === false || strlen($binary) < 1000) {
        http_response_code(400);
        echo json_encode([
            'status' => false,
            'msg' => "تصویر رسید معتبر نیست.",
        ]);
        return;
    }
    if (strlen($binary) > 5 * 1024 * 1024) {
        http_response_code(413);
        echo json_encode([
            'status' => false,
            'msg' => "حجم تصویر رسید زیاد است.",
        ]);
        return;
    }
    $extension = strtolower($match[1]) === 'jpeg' ? 'jpg' : strtolower($match[1]);
    $receiptPath = tempnam(sys_get_temp_dir(), 'mers_receipt_') . '.' . $extension;
    if (@file_put_contents($receiptPath, $binary) === false) {
        http_response_code(500);
        echo json_encode([
            'status' => false,
            'msg' => "ارسال رسید ناموفق بود.",
        ]);
        return;
    }
    $info = @getimagesize($receiptPath);
    if ($info === false) {
        @unlink($receiptPath);
        http_response_code(400);
        echo json_encode([
            'status' => false,
            'msg' => "تصویر رسید معتبر نیست.",
        ]);
        return;
    }
    $formatBalance = number_format(intval($usercheck['Balance']), 0);
    $formatPrice = number_format(intval($payment['price']), 0);
    $formatOrderId = htmlspecialchars($orderId, ENT_QUOTES, 'UTF-8');
    $formatUsername = htmlspecialchars($usercheck['username'], ENT_QUOTES, 'UTF-8');
    $textsendrasid = sprintf(
        $textbotlang['Admin']['reportgroup']['newPaymentBalance2'],
        $formatUsername,
        $usercheck['id'],
        $usercheck['id'],
        $formatBalance,
        $formatOrderId,
        $formatUsername,
        $formatPrice
    );
    $confirmPay = json_encode([
        'inline_keyboard' => [
            [
                ['text' => $textbotlang['users']['Balance']['confirmPaying'], 'callback_data' => "Confirm_pay_{$orderId}"],
                ['text' => $textbotlang['users']['Balance']['rejectPay'], 'callback_data' => "reject_pay_{$orderId}"],
            ],
            [
                ['text' => $textbotlang['users']['Balance']['addBalanceUser'], 'callback_data' => "addbalamceuser_{$orderId}"],
                ['text' => $textbotlang['users']['Balance']['blockedfake'], 'callback_data' => "blockuserfake_{$usercheck['id']}"],
            ]
        ]
    ]);
    $adminIds = select("admin", "id_admin", null, null, "FETCH_COLUMN");
    foreach ((array) $adminIds as $adminId) {
        $adminRule = select("admin", "*", "id_admin", $adminId, "select");
        if (is_array($adminRule) && $adminRule['rule'] == "support") {
            continue;
        }
        telegram('sendphoto', [
            'chat_id' => $adminId,
            'photo' => new CURLFile($receiptPath),
            'caption' => "رسید کارت به کارت | <code>{$formatOrderId}</code>",
            'parse_mode' => "HTML",
        ]);
        sendmessage($adminId, $textsendrasid, $confirmPay, 'HTML');
    }
    @unlink($receiptPath);
    update("payment_report", "payment_Status", "waiting", "id_order", $orderId);
    update("payment_report", "at_updated", date('Y/m/d H:i:s'), "id_order", $orderId);
    sendmessage($usercheck['id'], $textbotlang['users']['Balance']['sendReceipt'] ?? 'رسید شما ارسال شد.', null, 'HTML');
    echo json_encode([
        'status' => true,
        'msg' => "Successful",
        'obj' => [
            'order_id' => $orderId,
        ],
    ]);
}

function mini_test_info(array $data, string $method): void
{
    global $pdo, $textbotlang, $usercheck;

    if ($method !== "GET") {
        echo json_encode([
            'status' => false,
            'msg' => "Method invalid; must be GET",
        ]);
        return;
    }
    $panels = [];
    $stmt = $pdo->prepare("SELECT * FROM marzban_panel WHERE TestAccount = 'ONTestAccount' ORDER BY name_panel ASC");
    $stmt->execute();
    while ($panel = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $hidden = json_decode($panel['hide_user'] ?? '', true);
        if (is_array($hidden) && in_array($usercheck['id'], $hidden)) {
            continue;
        }
        $panels[] = [
            'id' => $panel['code_panel'],
            'name' => $panel['name_panel'],
            'need_username' => in_array(usernameMethodKey($panel['MethodUsername']), ['customUsername', 'customUsernameRandom'], true),
            'hours' => intval($panel['time_usertest']),
            'volume_mb' => intval($panel['val_usertest']),
        ];
    }
    $limit = intval($usercheck['limit_usertest']);
    $adminIds = select("admin", "id_admin", null, null, "FETCH_COLUMN");
    if (!is_array($adminIds)) {
        $adminIds = [];
    }
    $isAdmin = in_array($usercheck['id'], $adminIds);
    echo json_encode([
        'status' => true,
        'msg' => "Successful",
        'obj' => [
            'available' => count($panels) > 0 && ($limit > 0 || $isAdmin),
            'limit' => $limit,
            'is_admin' => $isAdmin,
            'panels' => $panels,
        ],
    ]);
}

function mini_test_purchase(array $data, string $method): void
{
    global $pdo, $setting, $textbotlang, $ManagePanel, $usercheck, $errorreport;

    if ($method !== "POST") {
        echo json_encode([
            'status' => false,
            'msg' => "Method invalid; must be POST",
        ]);
        return;
    }
    $userlimit = select("user", "*", "id", $usercheck['id'], "select");
    $adminIds = select("admin", "id_admin", null, null, "FETCH_COLUMN");
    if (!is_array($adminIds)) {
        $adminIds = [];
    }
    if (intval($userlimit['limit_usertest']) <= 0 && !in_array($usercheck['id'], $adminIds)) {
        http_response_code(403);
        echo json_encode([
            'status' => false,
            'msg' => "⚠️ محدودیت دریافت اکانت تست شما به پایان رسیده است .",
        ]);
        return;
    }
    $stmt = $pdo->prepare("SELECT * FROM marzban_panel WHERE TestAccount = 'ONTestAccount'");
    $stmt->execute();
    $testPanels = $stmt->fetchAll(PDO::FETCH_ASSOC);
    if (count($testPanels) == 0) {
        http_response_code(404);
        echo json_encode([
            'status' => false,
            'msg' => "❌ سرویس تست درحال حاضر غیرفعال می باشد.",
        ]);
        return;
    }
    $panel = null;
    if (count($testPanels) == 1) {
        $panel = $testPanels[0];
    } else {
        foreach ($testPanels as $item) {
            if ((string) $item['code_panel'] === (string) ($data['country_id'] ?? '')) {
                $panel = $item;
                break;
            }
        }
    }
    if ($panel === null) {
        http_response_code(400);
        echo json_encode([
            'status' => false,
            'msg' => "موقعیت سرویس تست را انتخاب کنید.",
        ]);
        return;
    }
    $hidden = json_decode($panel['hide_user'] ?? '', true);
    if (is_array($hidden) && in_array($usercheck['id'], $hidden)) {
        http_response_code(403);
        echo json_encode([
            'status' => false,
            'msg' => "❌ سرویس تست درحال حاضر غیرفعال می باشد.",
        ]);
        return;
    }
    if ($panel['type'] == "Manualsale") {
        $stmt = $pdo->prepare("SELECT COUNT(*) FROM manualsell WHERE codepanel = :codepanel AND codeproduct = 'usertest' AND status = 'active'");
        $stmt->bindValue(':codepanel', $panel['code_panel']);
        $stmt->execute();
        if ((int) $stmt->fetchColumn() == 0) {
            http_response_code(409);
            echo json_encode([
                'status' => false,
                'msg' => "❌ موجودی این سرویس به پایان رسیده.",
            ]);
            return;
        }
    }
    $customUsername = isset($data['custom_username']) && is_string($data['custom_username']) ? trim($data['custom_username']) : '';
    $needsUsername = in_array(usernameMethodKey($panel['MethodUsername']), ['customUsername', 'customUsernameRandom'], true);
    if ($needsUsername && $customUsername === '') {
        http_response_code(400);
        echo json_encode([
            'status' => false,
            'msg' => $textbotlang['users']['selectusername'] ?? 'لطفاً نام کاربری دلخواه را وارد کنید.',
        ]);
        return;
    }
    if ($needsUsername && !preg_match('~(?!_)^[a-z][a-z\d_]{2,32}(?<!_)$~i', $customUsername)) {
        http_response_code(400);
        echo json_encode([
            'status' => false,
            'msg' => $textbotlang['users']['invalidusername'] ?? 'نام کاربری نامعتبر است',
        ]);
        return;
    }
    $decrement = $pdo->prepare("UPDATE user SET limit_usertest = limit_usertest - 1 WHERE id = :id AND limit_usertest > 0");
    $decrement->execute([':id' => $usercheck['id']]);
    if ($decrement->rowCount() === 0) {
        http_response_code(403);
        echo json_encode([
            'status' => false,
            'msg' => "⚠️ محدودیت دریافت اکانت تست شما به پایان رسیده است .",
        ]);
        return;
    }

    $randomString = bin2hex(random_bytes(4));
    $restoreLimit = function () use ($pdo, $usercheck) {
        $stmt = $pdo->prepare("UPDATE user SET limit_usertest = limit_usertest + 1 WHERE id = :id");
        $stmt->execute([':id' => $usercheck['id']]);
    };
    $testName = $textbotlang['common']['labels']['testServiceName'];
    $notifctions = json_encode([
        'volume' => false,
        'time' => false,
    ]);
    try {
        $username_ac = generateUsername($usercheck['id'], $panel['MethodUsername'], $usercheck['username'], $randomString, $needsUsername ? $customUsername : null, $panel['namecustom'], $usercheck['namecustom']);
        $username_ac = strtolower($username_ac);
        $DataUserOut = $ManagePanel->DataUser($panel['name_panel'], $username_ac);
        if (isset($DataUserOut['username']) || rowExists("invoice", "username", $username_ac)) {
            $username_ac = rand(1000000, 9999999) . "_" . $username_ac;
        }
        $stmt = $pdo->prepare("INSERT IGNORE INTO invoice (id_user, id_invoice, username, time_sell, Service_location, name_product, price_product, Volume, Service_time, Status, notifctions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$usercheck['id'], $randomString, $username_ac, time(), $panel['name_panel'], $testName, 0, intval($panel['val_usertest']), intval($panel['time_usertest']), 'active', $notifctions]);
        $datac = [
            'expire' => strtotime(date("Y-m-d H:i:s", strtotime("+" . intval($panel['time_usertest']) . "hours"))),
            'data_limit' => intval($panel['val_usertest']) * 1048576,
            'from_id' => $usercheck['id'],
            'username' => $usercheck['username'],
            'type' => 'usertest_' . $usercheck['username'],
        ];
        $dataoutput = $ManagePanel->createUser($panel['name_panel'], "usertest", $username_ac, $datac);
    } catch (Throwable $e) {
        $dataoutput = ['username' => null, 'msg' => $e->getMessage()];
    }
    if (!is_array($dataoutput) || ($dataoutput['username'] ?? null) == null) {
        update("invoice", "Status", "Unsuccessful", "id_invoice", $randomString);
        $restoreLimit();
        $detail = json_encode(is_array($dataoutput) ? ($dataoutput['msg'] ?? null) : null);
        sendReport(sprintf($textbotlang['Admin']['reportgroup']['errorSubscriptionCreateAdmin'] ?? 'Test account error %s user %s', $detail, $usercheck['id'], $usercheck['username'], $panel['name_panel']), $setting['Channel_Report'], $errorreport);
        http_response_code(500);
        echo json_encode([
            'status' => false,
            'msg' => $textbotlang['users']['usertest']['errorcreat'] ?? 'ساخت اکانت تست با خطا مواجه شد',
        ]);
        return;
    }
    $output_config_link = $panel['sublink'] == "onsublink" ? ($dataoutput['subscription_url'] ?? "") : "";
    $config = "";
    if ($panel['config'] == "onconfig" && is_array($dataoutput['configs'] ?? null)) {
        foreach ($dataoutput['configs'] as $link) {
            $config .= "\n" . $link;
        }
    }
    $usertestinfo = json_encode([
        'inline_keyboard' => [
            [
                ['text' => $textbotlang['users']['help']['btninlinebuy'], 'callback_data' => "helpbtn"],
            ]
        ]
    ]);
    $testCaption = $textbotlang['textbot']['afterText'];
    if ($panel['type'] == "WGDashboard") {
        $testCaption = $textbotlang['users']['sell']['created'];
    }
    if ($panel['type'] == "ibsng" || $panel['type'] == "mikrotik") {
        $testCaption = $textbotlang['textbot']['afterPayIbsng'];
    }
    $caption = str_replace('{username}', "<code>{$dataoutput['username']}</code>", $testCaption);
    $caption = str_replace('{name_service}', $textbotlang['common']['labels']['test'], $caption);
    $caption = str_replace('{location}', $panel['name_panel'], $caption);
    $caption = str_replace('{day}', intval($panel['time_usertest']), $caption);
    $caption = str_replace('{volume}', intval($panel['val_usertest']), $caption);
    $caption = str_replace('{config}', "<code>{$output_config_link}</code>", $caption);
    $caption = str_replace('{links}', $config, $caption);
    $caption = str_replace('{links2}', $output_config_link, $caption);
    if ($panel['type'] == "ibsng" || $panel['type'] == "mikrotik") {
        $caption = str_replace('{password}', $dataoutput['subscription_url'], $caption);
        update("invoice", "user_info", $dataoutput['subscription_url'], "id_invoice", $randomString);
    }
    sendMessageService($panel, $dataoutput['configs'] ?? null, $output_config_link, $dataoutput['username'], $usertestinfo, $caption, $randomString, $usercheck['id'], __DIR__ . '/../images.jpg');
    echo json_encode([
        'status' => true,
        'msg' => "Successful",
        'obj' => [
            'order_id' => $randomString,
            'username' => $dataoutput['username'],
            'subscription_url' => $output_config_link,
        ],
    ]);
}

function mini_gateway_create(array $user, int $price, string $gateway, string $invoice): array
{
    global $pdo, $setting, $textbotlang, $usernamebot;

    $order_id = bin2hex(random_bytes(5));
    $dateacc = date('Y/m/d H:i:s');
    // 0.9.3 DirectPayment resolves orders via id_payment; FK requires the payment_report row to exist first.
    $linkOrder = function () use ($pdo, $user, $order_id, $invoice) {
        $invoiceParts = explode('|', $invoice);
        if (($invoiceParts[0] ?? '') === 'getconfigafterpay' && !empty($invoiceParts[1])) {
            $stmt = $pdo->prepare("UPDATE invoice SET id_payment = :oid WHERE id_user = :uid AND username = :username AND Status <> 'active'");
            $stmt->execute([':oid' => $order_id, ':uid' => $user['id'], ':username' => $invoiceParts[1]]);
            clearSelectCache('invoice');
        } elseif (($invoiceParts[0] ?? '') === 'getextenduser' && !empty($invoiceParts[1])) {
            $sub = explode('%', $invoiceParts[1]);
            if (!empty($sub[0]) && !empty($sub[1])) {
                $stmt = $pdo->prepare("UPDATE service_other SET id_payment = :oid WHERE id_user = :uid AND username = :username AND status = 'unpaid' AND value LIKE CONCAT('%', :marker, '%')");
                $stmt->execute([':oid' => $order_id, ':uid' => $user['id'], ':username' => $sub[0], ':marker' => $sub[1]]);
                clearSelectCache('service_other');
            }
        }
    };
    if ($gateway === 'zarinpal') {
        $pay = createPayZarinpal($price, $order_id);
        if (!is_array($pay) || ($pay['data']['code'] ?? null) != 100 || empty($pay['data']['authority'])) {
            throw new RuntimeException('zarinpal link');
        }
        $stmt = $pdo->prepare("INSERT INTO payment_report (id_user,id_order,time,price,payment_Status,Payment_Method,id_invoice,dec_not_confirmed) VALUES (?,?,?,?,?,?,?,?)");
        $stmt->execute([$user['id'], $order_id, $dateacc, $price, 'Unpaid', 'zarinpal', $invoice, $pay['data']['authority']]);
        $linkOrder();
        return ['type' => 'redirect', 'order_id' => $order_id, 'price' => $price, 'url' => "https://www.zarinpal.com/pg/StartPay/" . $pay['data']['authority']];
    }
    if ($gateway === 'aqayepardakht') {
        $pay = createPayaqayepardakht($price, $order_id);
        if (!is_array($pay) || ($pay['status'] ?? '') !== 'success' || empty($pay['transid'])) {
            throw new RuntimeException('aqayepardakht link');
        }
        $stmt = $pdo->prepare("INSERT INTO payment_report (id_user,id_order,time,price,payment_Status,Payment_Method,id_invoice) VALUES (?,?,?,?,?,?,?)");
        $stmt->execute([$user['id'], $order_id, $dateacc, $price, 'Unpaid', 'aqayepardakht', $invoice]);
        $linkOrder();
        return ['type' => 'redirect', 'order_id' => $order_id, 'price' => $price, 'url' => "https://panel.aqayepardakht.ir/startpay/" . $pay['transid']];
    }
    if ($gateway === 'variza') {
        $pay = createPayVariza($price, $order_id);
        if (!is_array($pay) || empty($pay['pay_url'])) {
            throw new RuntimeException('variza link');
        }
        $stmt = $pdo->prepare("INSERT INTO payment_report (id_user,id_order,time,price,payment_Status,Payment_Method,id_invoice,dec_not_confirmed) VALUES (?,?,?,?,?,?,?,?)");
        $stmt->execute([$user['id'], $order_id, $dateacc, $price, 'Unpaid', 'variza', $invoice, $pay['slug'] ?? $order_id]);
        $linkOrder();
        return ['type' => 'redirect', 'order_id' => $order_id, 'price' => $price, 'url' => $pay['pay_url']];
    }
    if ($gateway === 'cart') {
        if (trim((string) getPaySettingValue('Cartstatuspv', '')) === 'oncardpv') {
            $cartDirect = ltrim(trim((string) getPaySettingValue('CartDirect', '')), '@');
            if ($cartDirect === '' || $cartDirect === '0') {
                throw new RuntimeException('cart agent not set');
            }
            return ['type' => 'redirect', 'order_id' => $order_id, 'price' => $price, 'url' => 'https://t.me/' . $cartDirect];
        }
        $cardQuery = $pdo->query("SELECT * FROM card_number ORDER BY RAND() LIMIT 1");
        $card = $cardQuery ? $cardQuery->fetch(PDO::FETCH_ASSOC) : false;
        if (!$card || empty($card['cardnumber']) || empty($card['namecard'])) {
            throw new RuntimeException('no active card');
        }
        $stmt = $pdo->prepare("INSERT INTO payment_report (id_user,id_order,time,price,payment_Status,Payment_Method,id_invoice) VALUES (?,?,?,?,?,?,?)");
        $stmt->execute([$user['id'], $order_id, $dateacc, $price, 'Unpaid', 'cart to cart', $invoice]);
        $linkOrder();
        $replacements = [
            '{price}' => number_format($price),
            '{card_number}' => $card['cardnumber'],
            '{name_card}' => $card['namecard'],
        ];
        $buttons = [];
        if ($setting['statuscopycart'] == "1") {
            $buttons[] = [
                ['text' => $textbotlang['keyboard']['copyCardNumber'], 'copy_text' => ['text' => $card['cardnumber']]],
                ['text' => $textbotlang['keyboard']['copyAmount'], 'copy_text' => ['text' => $price . "0"]],
            ];
        }
        $buttons[] = [
            ['text' => $textbotlang['keyboard']['paidSendReceipt'], 'callback_data' => 'sendresidcart-' . $order_id],
        ];
        $message_id = telegram('sendmessage', [
            'chat_id' => $user['id'],
            'text' => strtr($textbotlang['textbot']['cart'], $replacements),
            'reply_markup' => json_encode(['inline_keyboard' => $buttons]),
            'parse_mode' => "HTML",
        ]);
        updatePaymentMessageId($message_id, $order_id);
        return [
            'type' => 'cart',
            'order_id' => $order_id,
            'price' => $price,
            'card_number' => $card['cardnumber'],
            'name_card' => $card['namecard'],
            'bot_username' => $usernamebot,
        ];
    }
    throw new RuntimeException('gateway invalid');
}

function mini_purchase_pay(array $data, string $method): void
{
    global $pdo, $textbotlang, $usercheck;

    if ($method !== "POST") {
        echo json_encode(['status' => false, 'msg' => "Method invalid; must be POST"]);
        return;
    }
    $username = isset($data['username']) && is_string($data['username']) ? trim($data['username']) : '';
    $gateway = isset($data['method']) && is_string($data['method']) ? $data['method'] : '';
    if ($username === '') {
        http_response_code(400);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['infoFetchErrorRestart']]);
        return;
    }
    $stmt = $pdo->prepare("SELECT * FROM invoice WHERE id_user = :id_user AND username = :username LIMIT 1");
    $stmt->execute([':id_user' => $usercheck['id'], ':username' => $username]);
    $invoice = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$invoice || $invoice['Status'] === 'active') {
        http_response_code(400);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['Balance']['restartPurchaseOrPay']]);
        return;
    }
    $methods = [];
    foreach (mini_wallet_methods($usercheck) as $item) {
        $methods[$item['id']] = $item;
    }
    if (!isset($methods[$gateway])) {
        http_response_code(400);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['Balance']['selectPayment'] ?? 'روش پرداخت نامعتبر است']);
        return;
    }
    $price = (int) round((float) $invoice['price_product']);
    $balance = (int) $usercheck['Balance'];
    $amount = $price - $balance;
    if ($amount <= 0) {
        http_response_code(400);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['Balance']['lessThanPrice']]);
        return;
    }
    $range = $methods[$gateway];
    if ($amount < $range['min'] || ($range['max'] > 0 && $amount > $range['max'])) {
        http_response_code(400);
        $rangeError = $range['max'] > 0
            ? sprintf($textbotlang['users']['Balance']['amountRangeError'] ?? 'مبلغ باید بین %s تا %s تومان باشد', number_format($range['min']), number_format($range['max']))
            : sprintf('مبلغ باید حداقل %s تومان باشد', number_format($range['min']));
        echo json_encode(['status' => false, 'msg' => $rangeError]);
        return;
    }
    try {
        $pay = mini_gateway_create($usercheck, $amount, $gateway, 'getconfigafterpay|' . $invoice['username']);
    } catch (Throwable $e) {
        error_log("Mini purchase payment failed: " . $e->getMessage());
        http_response_code(500);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['Balance']['errorLinkPayment'] ?? 'خطا در ایجاد لینک پرداخت']);
        return;
    }
    echo json_encode([
        'status' => true,
        'msg' => "Successful",
        'obj' => array_merge($pay, ['username' => $invoice['username'], 'balance' => $balance]),
    ]);
}

function mini_extend_info(array $data, string $method): void
{
    global $pdo, $textbotlang, $usercheck;

    if ($method !== "GET") {
        echo json_encode(['status' => false, 'msg' => "Method invalid; must be GET"]);
        return;
    }
    $username = isset($data['username']) && is_string($data['username']) ? trim($data['username']) : '';
    $stmt = $pdo->prepare("SELECT * FROM invoice WHERE id_user = :id_user AND username = :username LIMIT 1");
    $stmt->execute([':id_user' => $usercheck['id'], ':username' => $username]);
    $invoice = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$invoice) {
        http_response_code(404);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['extend']['renewalerror']]);
        return;
    }
    $panel = select("marzban_panel", "*", "name_panel", $invoice['Service_location'], "select");
    if (!$panel) {
        http_response_code(404);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['status']['infoUnavailable']]);
        return;
    }
    if (($panel['status_extend'] ?? '') === "off_extend") {
        http_response_code(403);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['extend']['notSupportedPanel']]);
        return;
    }
    $stmt = $pdo->prepare("SELECT * FROM product WHERE (Location = :loc OR Location = '/all') AND agent = :agent ORDER BY price_product ASC");
    $stmt->execute([':loc' => $panel['name_panel'], ':agent' => $usercheck['agent']]);
    $products = [];
    $current_code = '';
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $product) {
        $price = (float) $product['price_product'];
        if (intval($usercheck['pricediscount']) != 0) {
            $price = $price - (($price * $usercheck['pricediscount']) / 100);
        }
        $price = max((int) round($price), 0);
        $products[] = [
            'code_product' => $product['code_product'],
            'name_product' => $product['name_product'],
            'price_product' => $price,
            'Service_time' => intval($product['Service_time']),
            'Volume_constraint' => (float) $product['Volume_constraint'],
            'note' => $product['note'] ?? '',
        ];
        if ($current_code === '' && (string) $product['name_product'] === (string) $invoice['name_product']) {
            $current_code = (string) $product['code_product'];
        }
    }
    $directSettingRow = ['value' => config_get('shop', 'statusdirectpabuy')];
    $directSetting = is_array($directSettingRow) ? (string) $directSettingRow['value'] : '';
    $directAvailable = $directSetting !== "offdirectbuy" && count(mini_wallet_methods($usercheck)) > 0;
    echo json_encode([
        'status' => true,
        'msg' => "Successful",
        'obj' => [
            'username' => $invoice['username'],
            'panel' => $panel['name_panel'],
            'balance' => intval($usercheck['Balance']),
            'direct_pay' => $directAvailable,
            'current' => [
                'name_product' => $invoice['name_product'],
                'Service_time' => intval($invoice['Service_time']),
                'Volume_constraint' => (float) $invoice['Volume'],
            ],
            'current_code_product' => $current_code,
            'products' => $products,
        ],
    ]);
}

function mini_extend_purchase(array $data, string $method): void
{
    global $pdo, $setting, $textbotlang, $ManagePanel, $errorreport, $usercheck;

    if ($method !== "POST") {
        echo json_encode(['status' => false, 'msg' => "Method invalid; must be POST"]);
        return;
    }
    $username = isset($data['username']) && is_string($data['username']) ? trim($data['username']) : '';
    $codeproduct = isset($data['code_product']) && is_string($data['code_product']) ? trim($data['code_product']) : '';
    $stmt = $pdo->prepare("SELECT * FROM invoice WHERE id_user = :id_user AND username = :username LIMIT 1");
    $stmt->execute([':id_user' => $usercheck['id'], ':username' => $username]);
    $invoice = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$invoice || $codeproduct === '') {
        http_response_code(404);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['extend']['renewalerror']]);
        return;
    }
    $panel = select("marzban_panel", "*", "name_panel", $invoice['Service_location'], "select");
    if (!$panel) {
        http_response_code(404);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['status']['infoUnavailable']]);
        return;
    }
    if (($panel['status_extend'] ?? '') === "off_extend") {
        http_response_code(403);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['extend']['notSupportedPanel']]);
        return;
    }
    $stmt = $pdo->prepare("SELECT * FROM product WHERE (Location = :loc OR Location = '/all') AND agent = :agent AND code_product = :code");
    $stmt->execute([':loc' => $panel['name_panel'], ':agent' => $usercheck['agent'], ':code' => $codeproduct]);
    $product = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$product) {
        http_response_code(404);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['erroroccurred']]);
        return;
    }
    $price = (float) $product['price_product'];
    if (intval($usercheck['pricediscount']) != 0) {
        $price = $price - (($price * $usercheck['pricediscount']) / 100);
    }
    $price = max((int) round($price), 0);
    if ($price > 0 && (int) $usercheck['Balance'] < $price && $usercheck['agent'] != "n2") {
        $directSettingRow = ['value' => config_get('shop', 'statusdirectpabuy')];
        $directSetting = is_array($directSettingRow) ? (string) $directSettingRow['value'] : '';
        $directMethods = $directSetting === "offdirectbuy" ? array() : mini_wallet_methods($usercheck);
        if (empty($directMethods)) {
            http_response_code(402);
            $minbalance = number_format(mini_pay_range('minbalance', $usercheck['agent']));
            $maxbalance = number_format(mini_pay_range('maxbalance', $usercheck['agent']));
            echo json_encode(['status' => false, 'msg' => sprintf($textbotlang['users']['Balance']['insufficientbalance'], $minbalance, $maxbalance)]);
            return;
        }
        echo json_encode([
            'success' => true,
            'requires_payment' => true,
            'message' => "payment_required",
            'payment' => [
                'amount' => (int) round($price - (float) $usercheck['Balance']),
                'price' => (int) round($price),
                'balance' => (int) $usercheck['Balance'],
                'username' => $invoice['username'],
                'code_product' => $product['code_product'],
                'methods' => $directMethods,
            ],
        ]);
        return;
    }
    if (!deductBalance($usercheck, $price)) {
        http_response_code(402);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['Balance']['notEnoughBalance']]);
        return;
    }
    $DataUserOut = $ManagePanel->DataUser($panel['name_panel'], $invoice['username']);
    $extend = $ManagePanel->extend($panel['Methodextend'], $product['Volume_constraint'], $product['Service_time'], $invoice['username'], $product['code_product'], $panel['code_panel']);
    if (!is_array($extend) || ($extend['status'] ?? false) == false) {
        addBalance($usercheck['id'], $price);
        $extendMsg = json_encode(is_array($extend) ? ($extend['msg'] ?? $extend) : ($extend ?: 'unknown error'));
        $textreports = sprintf($textbotlang['Admin']['reportgroup']['errorRenewService2'] ?? '', $panel['name_panel'], $invoice['username'], $extendMsg);
        sendReport($textreports, $setting['Channel_Report'], $errorreport);
        http_response_code(500);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['extend']['errorSupport']]);
        return;
    }
    $value = json_encode([
        "volumebuy" => $product['Volume_constraint'],
        "Service_time" => $product['Service_time'],
        "oldvolume" => is_array($DataUserOut) ? ($DataUserOut['data_limit'] ?? null) : null,
        "oldtime" => is_array($DataUserOut) ? ($DataUserOut['expire'] ?? null) : null,
        'code_product' => $product['code_product'],
    ]);
    $stmt = $pdo->prepare("INSERT IGNORE INTO service_other (id_user, username, value, type, time, price,output) VALUES (:id_user, :username, :value, :type, :time, :price, :output)");
    $stmt->execute([
        ':id_user' => $usercheck['id'],
        ':username' => $invoice['username'],
        ':value' => $value,
        ':type' => "extends_not_user",
        ':time' => date('Y/m/d H:i:s'),
        ':price' => $product['price_product'],
        ':output' => json_encode($extend),
    ]);
    echo json_encode([
        'status' => true,
        'msg' => "Successful",
        'obj' => [
            'username' => $invoice['username'],
            'price' => $price,
            'balance' => intval(select("user", "Balance", "id", $usercheck['id'], "select")['Balance']),
        ],
    ]);
}

function mini_extend_pay(array $data, string $method): void
{
    global $pdo, $textbotlang, $ManagePanel, $usercheck;

    if ($method !== "POST") {
        echo json_encode(['status' => false, 'msg' => "Method invalid; must be POST"]);
        return;
    }
    $username = isset($data['username']) && is_string($data['username']) ? trim($data['username']) : '';
    $codeproduct = isset($data['code_product']) && is_string($data['code_product']) ? trim($data['code_product']) : '';
    $gateway = isset($data['method']) && is_string($data['method']) ? trim($data['method']) : '';
    if ($username === '' || $codeproduct === '' || $gateway === '') {
        http_response_code(400);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['extend']['renewalerror']]);
        return;
    }
    $stmt = $pdo->prepare("SELECT * FROM invoice WHERE id_user = :id_user AND username = :username LIMIT 1");
    $stmt->execute([':id_user' => $usercheck['id'], ':username' => $username]);
    $invoice = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$invoice) {
        http_response_code(404);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['extend']['renewalerror']]);
        return;
    }
    $panel = select("marzban_panel", "*", "name_panel", $invoice['Service_location'], "select");
    if (!$panel) {
        http_response_code(404);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['status']['infoUnavailable']]);
        return;
    }
    if (($panel['status_extend'] ?? '') === "off_extend") {
        http_response_code(403);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['extend']['notSupportedPanel']]);
        return;
    }
    $stmt = $pdo->prepare("SELECT * FROM product WHERE (Location = :loc OR Location = '/all') AND agent = :agent AND code_product = :code");
    $stmt->execute([':loc' => $panel['name_panel'], ':agent' => $usercheck['agent'], ':code' => $codeproduct]);
    $product = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$product) {
        http_response_code(404);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['erroroccurred']]);
        return;
    }
    $price = (float) $product['price_product'];
    if (intval($usercheck['pricediscount']) != 0) {
        $price = $price - (($price * $usercheck['pricediscount']) / 100);
    }
    $price = max((int) round($price), 0);
    $balance = (int) $usercheck['Balance'];
    $amount = $price - $balance;
    if ($amount <= 0) {
        http_response_code(400);
        echo json_encode(['status' => false, 'msg' => 'موجودی کیف پول شما کافی است؛ تمدید را از کیف پول انجام دهید.']);
        return;
    }
    $directSettingRow = ['value' => config_get('shop', 'statusdirectpabuy')];
    $directSetting = is_array($directSettingRow) ? (string) $directSettingRow['value'] : '';
    if ($directSetting === "offdirectbuy") {
        http_response_code(403);
        $minbalance = number_format(mini_pay_range('minbalance', $usercheck['agent']));
        $maxbalance = number_format(mini_pay_range('maxbalance', $usercheck['agent']));
        echo json_encode(['status' => false, 'msg' => sprintf($textbotlang['users']['Balance']['insufficientbalance'], $minbalance, $maxbalance)]);
        return;
    }
    $methods = [];
    foreach (mini_wallet_methods($usercheck) as $item) {
        $methods[$item['id']] = $item;
    }
    if (!isset($methods[$gateway])) {
        http_response_code(400);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['Balance']['selectPayment'] ?? 'روش پرداخت نامعتبر است']);
        return;
    }
    $range = $methods[$gateway];
    if ($amount < $range['min'] || ($range['max'] > 0 && $amount > $range['max'])) {
        http_response_code(400);
        $rangeError = $range['max'] > 0
            ? sprintf($textbotlang['users']['Balance']['amountRangeError'] ?? 'مبلغ باید بین %s تا %s تومان باشد', number_format($range['min']), number_format($range['max']))
            : sprintf('مبلغ باید حداقل %s تومان باشد', number_format($range['min']));
        echo json_encode(['status' => false, 'msg' => $rangeError]);
        return;
    }
    $DataUserOut = $ManagePanel->DataUser($panel['name_panel'], $invoice['username']);
    $marker = bin2hex(random_bytes(5));
    $value = json_encode([
        "volumebuy" => $product['Volume_constraint'],
        "Service_time" => $product['Service_time'],
        "oldvolume" => is_array($DataUserOut) ? ($DataUserOut['data_limit'] ?? null) : null,
        "oldtime" => is_array($DataUserOut) ? ($DataUserOut['expire'] ?? null) : null,
        'code_product' => $product['code_product'],
        'id_order' => $marker,
    ]);
    try {
        $stmt = $pdo->prepare("INSERT IGNORE INTO service_other (id_user, username, value, type, time, price, output, status) VALUES (:id_user, :username, :value, :type, :time, :price, :output, :status)");
        $stmt->execute([
            ':id_user' => $usercheck['id'],
            ':username' => $invoice['username'],
            ':value' => $value,
            ':type' => "extend_user",
            ':time' => date('Y/m/d H:i:s'),
            ':price' => (string) $price,
            ':output' => '',
            ':status' => 'unpaid',
        ]);
        $serviceOtherId = (int) $pdo->lastInsertId();
    } catch (Throwable $e) {
        error_log("Mini renew pending order failed: " . $e->getMessage());
        http_response_code(500);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['extend']['errorSupport']]);
        return;
    }
    try {
        $pay = mini_gateway_create($usercheck, $amount, $gateway, 'getextenduser|' . $invoice['username'] . '%' . $marker);
    } catch (Throwable $e) {
        if ($serviceOtherId > 0) {
            $stmt = $pdo->prepare("DELETE FROM service_other WHERE id = :id");
            $stmt->execute([':id' => $serviceOtherId]);
        }
        error_log("Mini renew payment failed: " . $e->getMessage());
        http_response_code(500);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['Balance']['errorLinkPayment'] ?? 'خطا در ایجاد لینک پرداخت']);
        return;
    }
    echo json_encode([
        'status' => true,
        'msg' => "Successful",
        'obj' => array_merge($pay, [
            'username' => $invoice['username'],
            'balance' => $balance,
            'amount' => $amount,
        ]),
    ]);
}

function mini_payment_status(array $data, string $method): void
{
    global $pdo, $usercheck;

    if ($method !== "GET") {
        echo json_encode(['status' => false, 'msg' => "Method invalid; must be GET"]);
        return;
    }
    $orderId = isset($data['order_id']) && is_string($data['order_id']) ? trim($data['order_id']) : '';
    if ($orderId === '') {
        http_response_code(400);
        echo json_encode(['status' => false, 'msg' => "شناسه سفارش نامعتبر است."]);
        return;
    }
    $payment = select("payment_report", "*", "id_order", $orderId, "select");
    if (!is_array($payment) || (string) $payment['id_user'] !== (string) $usercheck['id']) {
        http_response_code(404);
        echo json_encode(['status' => false, 'msg' => "پرداخت موردنظر یافت نشد."]);
        return;
    }
    $paymentStatus = (string) $payment['payment_Status'];
    $failed = in_array($paymentStatus, ['reject', 'expire'], true);
    $done = false;
    $username = '';
    $parts = explode('|', (string) $payment['id_invoice']);
    $kind = $parts[0] ?? '';
    if ($kind === 'getconfigafterpay' && !empty($parts[1])) {
        $username = $parts[1];
        $invoice = select("invoice", "*", "username", $username, "select");
        if (is_array($invoice) && (string) $invoice['id_user'] === (string) $usercheck['id']) {
            $done = (string) $invoice['Status'] === 'active';
        }
    } elseif ($kind === 'getextenduser' && !empty($parts[1])) {
        $sub = explode('%', $parts[1]);
        $username = $sub[0] ?? '';
        $marker = $sub[1] ?? '';
        if ($username !== '' && $marker !== '') {
            $stmt = $pdo->prepare("SELECT status FROM service_other WHERE username = :username AND id_user = :id_user AND value LIKE CONCAT('%', :marker, '%') ORDER BY id DESC LIMIT 1");
            $stmt->execute([':username' => $username, ':id_user' => $usercheck['id'], ':marker' => $marker]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            $done = is_array($row) && (string) $row['status'] === 'paid';
        }
    } else {
        $done = $paymentStatus === 'paid';
    }
    echo json_encode([
        'status' => true,
        'msg' => "Successful",
        'obj' => [
            'username' => $username,
            'payment_status' => $paymentStatus,
            'done' => $done,
            'failed' => $failed && !$done,
        ],
    ]);
}

function mini_support_info(array $data, string $method): void
{
    global $pdo, $textbotlang;

    if ($method !== "GET") {
        echo json_encode(['status' => false, 'msg' => "Method invalid; must be GET"]);
        return;
    }
    $departments = $pdo->query("SELECT id, name_departman FROM departman ORDER BY id ASC")->fetchAll(PDO::FETCH_ASSOC);
    $stmt = $pdo->prepare("SELECT * FROM (SELECT id, Tracking, name_departman, text, result, time, status FROM support_message WHERE iduser = :iduser ORDER BY id DESC LIMIT 200) AS recent ORDER BY id ASC");
    $stmt->execute([':iduser' => $data['user_id']]);
    $messages = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $timestamp = strtotime($row['time']);
        $result = (string) $row['result'];
        if ($result === '0' || $result === '') {
            $result = '';
        }
        $messages[] = [
            'id' => $row['Tracking'],
            'department' => $row['name_departman'],
            'text' => $row['text'],
            'result' => $result,
            'time' => $timestamp ? jdate('Y/m/d H:i', $timestamp) : $row['time'],
            'status' => $row['status'],
        ];
    }
    echo json_encode([
        'status' => true,
        'msg' => "Successful",
        'obj' => [
            'departments' => array_map(function ($item) {
                return ['id' => $item['id'], 'name' => $item['name_departman']];
            }, $departments),
            'messages' => $messages,
        ],
    ]);
}

function mini_support_send(array $data, string $method): void
{
    global $pdo, $textbotlang, $usercheck;

    if ($method !== "POST") {
        echo json_encode(['status' => false, 'msg' => "Method invalid; must be POST"]);
        return;
    }
    $text = isset($data['text']) && is_string($data['text']) ? trim($data['text']) : '';
    $departmentId = isset($data['department_id']) ? intval($data['department_id']) : 0;
    if ($text === '' || mb_strlen($text) > 2000) {
        http_response_code(400);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['support']['sendMessage']]);
        return;
    }
    $department = select("departman", "*", "id", $departmentId, "select");
    if (!$department) {
        http_response_code(400);
        echo json_encode(['status' => false, 'msg' => $textbotlang['users']['support']['selectDepartment']]);
        return;
    }
    $tracking = bin2hex(random_bytes(4));
    $time = date('Y/m/d H:i:s');
    $stmt = $pdo->prepare("INSERT IGNORE INTO support_message (Tracking,idsupport,iduser,name_departman,text,result,time,status) VALUES (:Tracking,:idsupport,:iduser,:name_departman,:text,:result,:time,:status)");
    $stmt->execute([
        ':Tracking' => $tracking,
        ':idsupport' => $department['idsupport'],
        ':iduser' => $usercheck['id'],
        ':name_departman' => $department['name_departman'],
        ':text' => $text,
        ':result' => '',
        ':time' => $time,
        ':status' => 'Unseen',
    ]);
    $timejalali = jdate('Y/m/d H:i:s');
    $textsupport = sprintf($textbotlang['Admin']['reportgroup']['supportMessage'], $usercheck['id'], $usercheck['id'], $timejalali, $usercheck['username'], $department['name_departman'], $text, '');
    $response = json_encode([
        'inline_keyboard' => [
            [
                ['text' => $textbotlang['users']['support']['answermessage'], 'callback_data' => 'Responsesupport_' . $tracking],
            ],
        ],
    ]);
    try {
        sendmessage($department['idsupport'], $textsupport, $response, 'HTML');
    } catch (Throwable $e) {
        error_log("Support notify failed: " . $e->getMessage());
    }
    $timestamp = strtotime($time);
    echo json_encode([
        'status' => true,
        'msg' => $textbotlang['users']['support']['sentForReview'],
        'obj' => [
            'id' => $tracking,
            'department' => $department['name_departman'],
            'text' => $text,
            'result' => '',
            'time' => $timestamp ? jdate('Y/m/d H:i', $timestamp) : $time,
            'status' => 'Unseen',
        ],
    ]);
}

match ($action) {
    'app_config' => mini_app_config($data, $method),
    'wallet_info' => mini_wallet_info($data, $method),
    'wallet_topup' => mini_wallet_topup($data, $method),
    'wallet_receipt' => mini_wallet_receipt($data, $method),
    'test_info' => mini_test_info($data, $method),
    'test_purchase' => mini_test_purchase($data, $method),
    'invoices' => mini_invoices($data, $method),
    'service' => mini_service($data, $method),
    'user_info' => mini_user_info($data, $method),
    'countries' => mini_countries($data, $method),
    'categories' => mini_categories($data, $method),
    'time_ranges' => mini_time_ranges($data, $method),
    'services' => mini_services($data, $method),
    'custom_price' => mini_custom_price($data, $method),
    'purchase' => mini_purchase($data, $method),
    'purchase_pay' => mini_purchase_pay($data, $method),
    'extend_info' => mini_extend_info($data, $method),
    'extend_purchase' => mini_extend_purchase($data, $method),
    'extend_pay' => mini_extend_pay($data, $method),
    'payment_status' => mini_payment_status($data, $method),
    'support_info' => mini_support_info($data, $method),
    'support_send' => mini_support_send($data, $method),
    default => sendJsonResponse(false, "Action Invalid", []),
};

