# 55-B. 스마트플레이스 입력 항목 실사 — 공식 도움말 기준 (Codex gpt-6-astra 웹 조사, 2026-09-14)

- 수행: codex exec -m gpt-6-astra, read-only, 웹 검색만(브라우저 불가). 55·57번 항목표 검증용 부록. 관리화면 직접 확인은 미수행 — '불명' 항목은 태양이 스마트플레이스에서 확인.

**확인 기준일: 2026년 9월 14일.** 네이버 공식 도움말·스마트플레이스 공지를 우선 검색했습니다. **대표키워드는 현재 도움말상 최대 5개이며, 스마트콜은 종료된 것으로 확인되지 않습니다.** 오히려 2026년 5월 스마트콜 스팸필터 신설 공지가 확인됩니다. [대표키워드 도움말](https://help.naver.com/service/30026/contents/20379?lang=ko&osType=PC), [스마트콜 신설 공지](https://m.smartplace.naver.com/notices/1021)

다만 **아래 목록을 모든 업종·가입 상태의 실제 관리화면까지 검증한 ‘완전한 전수 목록’이라고 단정할 수는 없습니다.** 공개문서에 확인되는 항목을 최대한 수집한 목록입니다. 공지 이미지 일부를 판독하지 못했고, 연결 가능한 브라우저가 없어 실제 화면 확인도 불가능했습니다. 세부 선택지·최신 적용 여부를 확인하지 못한 부분은 **불명**으로 남겼습니다.

표의 해석 기준은 다음과 같습니다.

- **노출 ‘예’**: 플레이스·지도 또는 연결된 예약·주문 이용자 화면에 표시되는 항목입니다. 모든 업체·검색 결과에서의 노출을 보장한다는 뜻은 아닙니다. [노출 기준](https://help.naver.com/service/30026/contents/20428?lang=ko&osType=COMMONOS)
- **‘조건부’**: 업종·연동·게시 설정·예약 단계 등에 따라 표시됩니다.
- 입력 형식은 실제 저장 스키마가 아닌 **입력 방식의 분류**입니다. URL·전화번호·선택형 문구는 텍스트, 시간은 날짜/시간으로 표기했습니다.
- 같은 설정군의 관련 항목은 한 행에 병기했습니다. 공식 표기는 도움말 본문을 따랐으며, 괄호 안은 범위 설명입니다.
- 날짜가 없는 도움말의 **최종 개정일은 불명**입니다. 최근 검색 수집일을 개정일로 간주하지 않았습니다.

**기본정보·소개·키워드**

| 영역 | 항목명(공식 표기) | 입력 형식 | 공개 페이지에 노출되는가 | 출처 URL |
|---|---|---|---|---|
| 기본정보 | 업체명 | 텍스트 | 예, 심사 반영 | [등록](https://help.naver.com/service/30026/contents/20366?osType=COMMONOS) |
| 기본정보 | 업종 | 텍스트·선택 | 예, 심사 반영 | [수정](https://help.naver.com/service/30026/contents/20379?lang=ko&osType=PC) |
| 기본정보 | 전화번호 | 텍스트 | 예, 스마트콜 적용 시 표시 번호가 달라질 수 있음 | [등록](https://help.naver.com/service/30026/contents/20366?osType=COMMONOS) |
| 기본정보 | 관련 전화번호 | 텍스트 | 불명. 작성기준에는 대표전화 1개·관련 전화 5개 등록 가능 명시 | [작성기준](https://smartplace.naver.com/help/policy?menu=modify) |
| 기본정보 | 주소 및 지도 위치 | 텍스트·지도 선택; 좌표 직접입력 여부 불명 | 예 | [등록](https://help.naver.com/service/30026/contents/20366?osType=COMMONOS) |
| 기본정보 | 찾아오는길 / 찾아오는 길 | 텍스트 | 예 | [수정](https://help.naver.com/service/30026/contents/20379?lang=ko&osType=PC), [작성기준](https://smartplace.naver.com/help/policy?menu=modify) |
| 기본정보 | 업체 전화번호 숨기기 | 불리언 | 설정에 따라 전화번호 미노출 | [삭제·전화 숨김 안내](https://help.naver.com/service/5614/contents/20445?lang=ko&osType=PC) |
| 기본정보 | 휴무일 구분 | 텍스트·선택 | 예, 층·기간별 구분 | [영업시간](https://help.naver.com/service/30026/contents/20380?osType=MOBILE) |
| 기본정보 | 휴무일이 있어요 / 휴무일이 없어요 | 불리언 | 결과 반영 | [영업시간](https://help.naver.com/service/30026/contents/20380?osType=MOBILE) |
| 기본정보 | 정기 휴무일 | 날짜·요일·반복 선택 | 예 | [영업시간](https://help.naver.com/service/30026/contents/20380?osType=MOBILE) |
| 기본정보 | 공휴일 중 휴무일 | 불리언·날짜 선택 | 예 | [영업시간](https://help.naver.com/service/30026/contents/20380?osType=MOBILE) |
| 기본정보 | 임시공휴일 | 불리언·날짜 선택 | 예 | [영업시간](https://help.naver.com/service/30026/contents/20380?osType=MOBILE) |
| 기본정보 | 특정일 휴무 / 임시휴무일 | 날짜·반복 선택 | 예 | [영업시간](https://help.naver.com/service/30026/contents/20380?osType=MOBILE) |
| 기본정보 | 기본 영업시간 | 날짜/시간、요일 선택 | 예、5분 단위 설정 안내 | [영업시간](https://help.naver.com/service/30026/contents/20380?osType=MOBILE) |
| 기본정보 | 휴게 시간 | 날짜/시간 | 예、브레이크타임에 대응 | [영업시간](https://help.naver.com/service/30026/contents/20380?osType=MOBILE) |
| 기본정보 | 임시 영업 일정 | 날짜/시간 | 예 | [영업시간](https://help.naver.com/service/30026/contents/20380?osType=MOBILE) |
| 기본정보 | 라스트 오더 | 날짜/시간 | 조건부、음식점·병의원 업종 안내 | [영업시간](https://help.naver.com/service/30026/contents/20380?osType=MOBILE) |
| 기본정보 | 영업시간 추가설명 | 텍스트 | 작성기준상 노출 항목、현재 별도 입력창·글자수 적용은 불명 | [작성기준](https://smartplace.naver.com/help/policy?menu=modify) |
| 소개·키워드 | 상세 설명 / 상세설명 | 텍스트 | 예 | [수정](https://help.naver.com/service/30026/contents/20379?lang=ko&osType=PC) |
| 소개·키워드 | 대표키워드 | 텍스트、최대 5개 | 입력값 전체가 독립 목록으로 공개되는지는 불명 | [수정](https://help.naver.com/service/30026/contents/20379?lang=ko&osType=PC) |
| 소개·키워드 | 홍보문구 | 텍스트 | 조건부、숙박 부가정보 및 예약 제작에서 확인 | [업체 수정](https://help.naver.com/service/30026/contents/20379?lang=ko&osType=PC), [예약 제작](https://help.naver.com/service/30026/contents/20674?osType=COMMONOS) |
| 소개·키워드 | 테마 | 텍스트·선택 | 불명、음식점·미용실·네일샵 설정 항목은 확인 | [수정](https://help.naver.com/service/30026/contents/20379?lang=ko&osType=PC) |
| 기타 | 홈페이지/SNS | 텍스트・URL | 예、개별 지원 플랫폼·개수 전수는 불명 | [수정](https://help.naver.com/service/30026/contents/20379?lang=ko&osType=PC), [URL 작성기준](https://smartplace.naver.com/help/policy?menu=modify) |

**메뉴·사진·소식**

| 영역 | 항목명(공식 표기) | 입력 형식 | 공개 페이지에 노출되는가 | 출처 URL |
|---|---|---|---|---|
| 메뉴 | 메뉴 정보 / 가격정보：서비스·메뉴·상품명、가격 | 텍스트·숫자 | 조건부、주문·제휴 메뉴가 우선할 수 있음 | [작성기준](https://smartplace.naver.com/help/policy?menu=modify), [메뉴 연동](https://help.naver.com/service/30026/contents/20541?lang=ko) |
| 메뉴 | 메뉴판 사진 | 이미지 | 조건부、음식점 입력 항목 확인 | [수정](https://help.naver.com/service/30026/contents/20379?lang=ko&osType=PC) |
| 메뉴 | 메뉴 이미지（예약·주문） | 이미지 | 조건부、예약·주문 메뉴 | [2026 이미지 정책 공지](https://m.smartplace.naver.com/notices/968) |
| 메뉴 | 옵션(시술메뉴/메뉴)명、판매가 | 텍스트·숫자 | 조건부、예약·주문 화면 | [옵션 등록](https://help.naver.com/service/30026/contents/20704?osType=COMMONOS) |
| 메뉴 | 메뉴옵션 / 옵션등록 | 텍스트·숫자、세부 구성 불명 | 조건부、토핑·샷 추가 등 | [주문 메뉴 수정](https://help.naver.com/service/30011/contents/18029?lang=ko&osType=COMMONOS) |
| 메뉴 | 카테고리、순서 변경 / 노출 순서 | 텍스트·選択、숫자 상당의 순서 조작 | 예、주문 메뉴 구성에 반영 | [주문 메뉴 수정](https://help.naver.com/service/30011/contents/18029?lang=ko&osType=COMMONOS) |
| 메뉴 | 맵기、추천표기、신메뉴 | 텍스트·선택 / 불리언 | 조건부、주문 메뉴 | [주문 메뉴 수정](https://help.naver.com/service/30011/contents/18029?lang=ko&osType=COMMONOS) |
| 메뉴 | 원산지정보 / 원산지 정보 관리、영양정보 | 텍스트·숫자、상세 형식 불명 | 조건부、주문 메뉴 | [주문 메뉴 수정](https://help.naver.com/service/30011/contents/18029?lang=ko&osType=COMMONOS) |
| 메뉴 | 품절、오늘품절 | 불리언 | 예、주문 가능 여부에 반영 | [주문 메뉴 수정](https://help.naver.com/service/30011/contents/18029?lang=ko&osType=COMMONOS) |
| 메뉴 | 상품연결、판매시간 | 불리언·날짜/시간 | 조건부、옵션·메뉴 판매 여부 | [옵션 등록](https://help.naver.com/service/30026/contents/20704?osType=COMMONOS) |
| 사진 | 업체 사진 / 사진정보 | 이미지 | 예、자동 수집 사진과 함께 표시될 수 있음 | [이미지 노출](https://help.naver.com/service/30026/contents/20429?lang=ko&osType=COMMONOS) |
| 사진 | 대표 사진 / 대표이미지 | 이미지 선택 | 예、검색 시스템에 따른 차이 가능 | [대표사진 설정 공지](https://new.smartplace.naver.com/notices/552), [정보 통합](https://help.naver.com/service/30026/contents/20673?osType=COMMONOS) |
| 사진 | 노출순서 변경 | 숫자 상당의 순서 조작 | 예、업체 등록사진 순서 | [사진 등록 공지](https://new.smartplace.naver.com/notices/552) |
| 사진 | 인테리어·외관 사진의 수동 구분 | **불명** | **불명**、AI 분류 태그와 구별 필요 | [사진탭 AI 분류](https://help.naver.com/service/30026/contents/25439?lang=ko&osType=COMMONOS) |
| 소식 | 새소식：제목、소식 | 텍스트 | 예 | [작성 공지](https://smartplace.naver.com/notices/695) |
| 소식 | 새소식：사진、동영상 | 이미지 / 동영상¹ | 예 | [작성 공지](https://smartplace.naver.com/notices/695) |
| 소식 | 새소식 적용 일정（이벤트 진행 기간 등） | 날짜 | 예 | [작성 공지](https://smartplace.naver.com/notices/695) |
| 소식 | 공지로 등록、공지 노출 일정 | 불리언·날짜 | 예、홈 공지 | [관리 도움말](https://help.naver.com/service/30026/contents/20513?lang=ko&osType=COMMONOS) |
| 소식 | 공지 순서 설정 / 공지 순서 변경 | 숫자 상당의 순서 조작 | 예 | [관리 도움말](https://help.naver.com/service/30026/contents/20513?lang=ko&osType=COMMONOS) |
| 소식 | 블로그 새소식 연결하기：블로그 주소、블로그 카테고리 | 텍스트・URL·선택 | 조건부、소식 탭에 연동 | [블로그 연동](https://help.naver.com/service/23029/contents/20508?lang=ko&osType=COMMONOS) |

¹ 동영상은 요청하신 다섯 입력 형식에 들어가지 않으므로 이미지로 오분류하지 않고 따로 표시했습니다.

**편의시설·주차·식당 특화정보**

2026년 신설 텍스트 필드는 **숙박 업종 일부에서 입력할 수 없다는 예외**가 있습니다. ‘공통’이라는 명칭을 모든 업종에서 동일하게 제공한다는 의미로 해석하면 안 됩니다. [공통 부가정보·음식점 특화정보 도움말](https://help.naver.com/service/30026/contents/25094?lang=ko&osType=COMMONOS)

| 영역 | 항목명(공식 표기) | 입력 형식 | 공개 페이지에 노출되는가 | 출처 URL |
|---|---|---|---|---|
| 편의시설 | 제공 시설 | 불리언·복수 선택 | 조건부、전체 선택지 목록은 불명 | [업체 수정](https://help.naver.com/service/30026/contents/20379?lang=ko&osType=PC) |
| 편의시설 | 유아의자、대기공간 | 불리언 | 조건부、입력 항목 신설 확인 | [부가정보 확장 공지](https://smartplace.naver.com/notices/676) |
| 편의시설 | 주차 정보：주차 가능 여부 | 불리언 | 예 | [부가정보 확장](https://smartplace.naver.com/notices/676) |
| 편의시설 | 주차：이용 금액、추가 설명、주차 위치 | 숫자·텍스트 | 조건부 | [부가정보 확장](https://smartplace.naver.com/notices/676), [예약 주차안내](https://help.naver.com/service/30026/contents/20675?lang=ko&osType=COMMONOS) |
| 편의시설 | 주차비：유료/무료、시간당 과금/정액 과금 | 텍스트·선택 | 예、예약·주문 주차안내 | [주차안내](https://help.naver.com/service/30026/contents/20675?lang=ko&osType=COMMONOS) |
| 편의시설 | 최초요금、추가요금、최대요금、1회 주차 요금 | 숫자 | 예、예약·주문 주차안내 | [주차안내](https://help.naver.com/service/30026/contents/20675?lang=ko&osType=COMMONOS) |
| 편의시설 | 주차 과금 시간 | 숫자・시간 선택 | 예、예약·주문 주차안내 | [주차안내](https://help.naver.com/service/30026/contents/20675?lang=ko&osType=COMMONOS) |
| 편의시설 | 발렛파킹：가능 여부、유료/무료/불가、이용 금액、추가 설명 | 불리언·텍스트·숫자 | 예／조건부 | [부가정보 확장](https://smartplace.naver.com/notices/676), [주차안내](https://help.naver.com/service/30026/contents/20675?lang=ko&osType=COMMONOS) |
| 편의시설 | 장애인 시설 / 장애인 편의시설 | 불리언·복수 선택 | 조건부、全選択肢は不明 | [업체 수정](https://help.naver.com/service/30026/contents/20379?lang=ko&osType=PC), [확장 공지](https://smartplace.naver.com/notices/676) |
| 편의시설 | 장애인 주차구역 | 불리언 | 조건부 | [확장 공지](https://smartplace.naver.com/notices/676) |
| 편의시설 | 결제수단、간편결제 | 불리언·복수 선택 | 조건부、지원 수단 전수는 불명 | [업체 수정](https://help.naver.com/service/30026/contents/20379?lang=ko&osType=PC), [확장 공지](https://smartplace.naver.com/notices/676) |
| 편의시설 | 반려동물 동반：가능여부、상세설명 | 불리언·텍스트 | 예、2026년 개편 | [도움말](https://help.naver.com/service/30026/contents/25094?lang=ko&osType=COMMONOS), [노출 공지](https://new.smartplace.naver.com/notices/1063) |
| 편의시설 | 노키즈존：운영여부、상세설명 | 불리언·텍스트 | 예、2026년 개편 | [도움말](https://help.naver.com/service/30026/contents/25094?lang=ko&osType=COMMONOS), [노출 공지](https://new.smartplace.naver.com/notices/1063) |
| 편의시설 | 인근 주차 가능한 장소 정보 / 인근 주차장 소개 | 텍스트、구조화 장소 선택 여부 불명 | 예、등록 업체 홈·정보 탭 | [도움말](https://help.naver.com/service/30026/contents/25094?lang=ko&osType=COMMONOS), [노출 공지](https://new.smartplace.naver.com/notices/1063) |
| 편의시설 | 좌석/공간：룸、단체석 인원、기타 좌석/공간 | 불리언·숫자·텍스트/선택 | 조건부、식당 | [입력 공지](https://smartplace.naver.com/notices/676), [2026 노출](https://new.smartplace.naver.com/notices/1063) |
| 편의시설 | 대관가능여부、상세설명 | 불리언·텍스트 | 조건부、식당 | [도움말](https://help.naver.com/service/30026/contents/25094?lang=ko&osType=COMMONOS) |
| 편의시설 | 콜키지：가능 여부、일부 무료、조건 | 불리언·텍스트·선택 | 조건부、식당 | [도움말](https://help.naver.com/service/30026/contents/25094?lang=ko&osType=COMMONOS) |
| 편의시설 | 콜키지：반입할 수 있는 병 수、비용、이용 조건 | 숫자·텍스트 | 조건부、식당 | [2026 노출 공지](https://new.smartplace.naver.com/notices/1063) |
| 편의시설 | 주류주문 필수：텍스트입력 필드 | 텍스트、독립 토글 여부 불명 | 조건부、식당 | [도움말](https://help.naver.com/service/30026/contents/25094?lang=ko&osType=COMMONOS) |
| 편의시설 | 키즈메뉴 | 불리언・선택 | 조건부、식당 | [도움말](https://help.naver.com/service/30026/contents/25094?lang=ko&osType=COMMONOS) |
| 편의시설 | 생일/기념일 혜택 | 불리언・선택、설명 입력 형식 불명 | 조건부、식당 | [도움말](https://help.naver.com/service/30026/contents/25094?lang=ko&osType=COMMONOS) |
| 편의시설 | 소믈리에（구 전문 소믈리에） | 선택 항목、정확한 입력 형식 불명 | 조건부、식당 | [2026 변경 공지](https://new.smartplace.naver.com/notices/1063) |

**예약·주문 설정**

업체 영업시간과 **예약 상품 일정은 별도 관리**입니다. 반면 업체사진·상세설명 등 일부 기본정보는 통합됩니다. [예약 일정](https://help.naver.com/service/30026/contents/20693?osType=COMMONOS), [기본정보 통합](https://help.naver.com/service/30026/contents/20673?osType=COMMONOS)

아래 표에서 영역의 **‘예약·주문 등’은 요청하신 ‘예약·주문·톡톡·스마트콜·쿠폰’ 영역을 줄인 표기**입니다.

| 영역 | 항목명(공식 표기) | 입력 형식 | 공개 페이지에 노출되는가 | 출처 URL |
|---|---|---|---|---|
| 예약·주문 등 | 네이버 예약 사용하기、예약 서비스 유형 | 불리언·텍스트/선택 | 조건부、연결·검수 후 | [신청](https://help.naver.com/service/30026/contents/20509?osType=COMMONOS), [제작](https://help.naver.com/service/30026/contents/20674?osType=COMMONOS) |
| 예약·주문 등 | 예약상품：노출/미노출、예약·주문받기 | 불리언 | 예、판매·버튼 노출에 반영 | [제작](https://help.naver.com/service/30026/contents/20674?osType=COMMONOS), [주문 버튼](https://help.naver.com/service/30026/contents/20706?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | 예약문의 | 텍스트・전화번호 | 예、업체 전화와 별도 설정 | [기본정보](https://help.naver.com/service/30026/contents/20673?osType=COMMONOS) |
| 예약·주문 등 | 웹사이트 | 텍스트・URL | 예、예약용 별도 설정 | [기본정보](https://help.naver.com/service/30026/contents/20673?osType=COMMONOS) |
| 예약·주문 등 | 관리자 연락처 | 텍스트・전화번호 | 아니요 | [기본정보](https://help.naver.com/service/30026/contents/20673?osType=COMMONOS) |
| 예약·주문 등 | 상품 목록 템플릿：이미지형、텍스트형、혼합형 | 텍스트・선택 | 조건부、예약 서비스 URL 화면 | [템플릿](https://help.naver.com/service/30026/contents/20678?osType=COMMONOS) |
| 예약·주문 등 | 예약 상품 유형：일반、룸/좌석、포장、기타 예약 | 텍스트・선택 | 조건부、식당 일반형 | [일반형](https://help.naver.com/service/30026/contents/20693?osType=COMMONOS) |
| 예약·주문 등 | 상품 사진、상품 소개 | 이미지·텍스트 | 예、해당 예약상품 | [상품 설정](https://help.naver.com/service/30026/contents/20699?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | 꼭 확인해 주세요!、룸 이용안내、이용안내、이용시간 안내 / 알립니다.(유의사항) | 텍스트 | 예、상품 유형별 | [식당](https://help.naver.com/service/30026/contents/20693?osType=COMMONOS), [공간대여](https://help.naver.com/service/30026/contents/20699?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | 예약 가능 시간、예약 시간、예약 신청 가능 기간 | 날짜/시간·숫자 | 예、선택 가능한 일정으로 반영 | [일반형](https://help.naver.com/service/30026/contents/20693?osType=COMMONOS) |
| 예약·주문 등 | 인원 수、시간별 예약 가능 인원 수、예약자구분 | 숫자·텍스트/선택 | 조건부、식당 일반형 | [일반형](https://help.naver.com/service/30026/contents/20693?osType=COMMONOS) |
| 예약·주문 등 | 인원으로 관리 / 예약 건수로 관리 | 텍스트・선택 | 내부 방식、잔여 예약 가능량에反映 | [일반형](https://help.naver.com/service/30026/contents/20693?osType=COMMONOS) |
| 예약·주문 등 | 금액까지 받기、가격、메뉴 선택 필수 여부 | 불리언·숫자 | 예、예약 과정 | [일반형](https://help.naver.com/service/30026/contents/20693?osType=COMMONOS) |
| 예약·주문 등 | 예약 필수옵션(메뉴)、예약금、판매가 | 텍스트·숫자·선택 | 예、연결된 상품 | [옵션·예약금](https://help.naver.com/service/30026/contents/20704?osType=COMMONOS) |
| 예약·주문 등 | 휴무일、임시운영、전체마감、시간대 마감 | 날짜/시간·불리언 | 예약 불가·가능 상태로 반영 | [휴무 설정](https://help.naver.com/service/11712/contents/7602?osType=COMMONOS) |
| 예약·주문 등 | 예약 가능 수량、일정별 가격、옵션연결 | 숫자·날짜·불리언 | 조건부、상품 유형별 | [공간대여](https://help.naver.com/service/30026/contents/20699?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | 예약 확정 방식：관리자 확인 후 확정 / 예약 신청과 동시에 바로확정 | 텍스트・선택 | 조건부、예약 과정에反映 | [확정 방식](https://help.naver.com/service/30026/contents/20641?osType=COMMONOS) |
| 예약·주문 등 | 테이블주문、포장주문、주문시간 | 불리언·날짜/시간 | 예、주문 가능 상태로 반영 | [설정](https://help.naver.com/service/30026/contents/20693?osType=COMMONOS) |
| 예약·주문 등 | 예약자 정보 요청：질문지、선택지、상품별 설정 | 텍스트·불리언 | 예약 작성 화면、응답은 일반 공개 아님 | [상품별 질문](https://help.naver.com/service/30026/contents/20699?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | 예약자 안내 문구 설정、자동확정안내 문구 | 텍스트 | 아니요、해당 예약자 알림에 표시 | [안내 문구](https://help.naver.com/service/11712/contents/7580?lang=ko) |
| 예약·주문 등 | 네이버 알림：전체 설정、상품별 설정、수신 ID | 불리언·텍스트 | 아니요、관리자용 | [전체 알림](https://help.naver.com/service/11712/contents/7604?lang=ko&osType=COMMONOS), [상품별](https://help.naver.com/service/11712/contents/23178?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | 전화 음성 알림、수신 전화번호 | 불리언·텍스트 | 아니요、관리자용 | [전화 알림](https://help.naver.com/service/11712/contents/7606?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | PC 실시간 알림 | 불리언 | 아니요、관리자용 | [PC 알림](https://help.naver.com/service/30026/contents/20649?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | 환불기준：일정별 환불 비율、환불 기준 시각 | 숫자·날짜/시간 | 예、예약 조건 | [환불 설정](https://help.naver.com/service/30026/contents/20751?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | 결제 직후 취소 시 전액 환불 설정 | 숫자・시간 | 조건부、숙박형 | [환불 설정](https://help.naver.com/service/30026/contents/20751?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | 환불금이 없는 경우 취소 버튼 노출 여부 | 불리언 | 해당 예약자 화면에 반영 | [환불 설정](https://help.naver.com/service/30026/contents/20751?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | 이용 기간 지난 예매확정 건 처리：자동 취소 / 자동 이용 완료 | 텍스트・선택 | 아니요、처리 결과는 예약자에게 반영 | [환불·처리 설정](https://help.naver.com/service/30026/contents/20751?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | 관리자 취소 사유、환불 조건·금액 | 텍스트·숫자 | 일반 공개 아님、해당 이용자에게 공개 | [예약 취소](https://help.naver.com/service/11712/contents/18720?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | 외국인 예약·주문받기、당일 예약、리마인드 알림、배경 색상 | **세부 입력 형식 불명** | **불명**、기능·도움말 제목까지만 확인한 항목 포함 | [운영 설정 목록](https://help.naver.com/service/30026/category/5904?lang=ko), [제작 설정 목록](https://help.naver.com/service/30026/contents/20674?lang=ko) |

**톡톡·스마트콜·쿠폰**

| 영역 | 항목명(공식 표기) | 입력 형식 | 공개 페이지에 노출되는가 | 출처 URL |
|---|---|---|---|---|
| 예약·주문 등 | 톡톡연결 / 네이버톡톡 사용하기 | 불리언·계정 선택 | 예、톡톡 버튼 | [톡톡 신청](https://help.naver.com/service/30026/contents/20509?osType=COMMONOS) |
| 예약·주문 등 | 스마트콜 사용하기 / 우리 가게 전화 대신 받아주기 | 불리언 | 예、가상번호·전화 기능 | [도움말](https://help.naver.com/service/30026/contents/20475?lang=ko), [설정 공지](https://new.smartplace.naver.com/notices/765) |
| 예약·주문 등 | 2차 연결번호 | 텍스트・전화번호 | 공개 번호인지 불명、전화 연결에 사용 | [2차 번호](https://help.naver.com/service/30026/contents/20482?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | 스마트 ARS 사용하기 | 불리언 | 페이지 텍스트 아님、통화 시 적용 | [ARS](https://help.naver.com/service/30026/contents/20483?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | ARS 항목：통화 연결、예약 정보、매장 위치、주차 안내、영업시간 | 텍스트·선택·순서 | 통화 시 안내、1~5번 설정 | [ARS](https://help.naver.com/service/30026/contents/20483?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | ARS 안내 예외사항 | 텍스트 | 통화 시 음성 안내 | [ARS 설정 공지](https://smartplace.naver.com/notices/582) |
| 예약·주문 등 | 통화연결음 문구 | 텍스트 | 페이지 아님、통화 시 재생 | [통화연결음](https://help.naver.com/service/30026/contents/25169?osType=COMMONOS) |
| 예약·주문 등 | 전화를 받을 수 없는 시간、해당 통화연결음 | 날짜/시간·텍스트 | 페이지 아님、통화 시 재생 | [통화연결음](https://help.naver.com/service/30026/contents/25169?osType=COMMONOS) |
| 예약·주문 등 | 수신알림음 | 텍스트・선택 | 아니요、수신 측 알림 | [수신알림음 공지](https://new.smartplace.naver.com/notices/765) |
| 예약·주문 등 | 스팸필터 | 불리언 | 아니요、수신 차단에 적용 | [2026 신설](https://m.smartplace.naver.com/notices/1021) |
| 예약·주문 등 | 차단 전화번호、차단 사유、차단 해제 | 텍스트·선택·불리언 | 아니요 | [2026 신설](https://m.smartplace.naver.com/notices/1021) |
| 예약·주문 등 | 쿠폰 종류：결제 금액 할인 쿠폰 / 무료 증정 쿠폰 | 텍스트・선택 | 예 | [공식 쿠폰 소개](https://new.smartplace.naver.com/introduction/solution-market/coupon) |
| 예약·주문 등 | 쿠폰 사용 장소：매장、예약、주문 | 텍스트・선택 | 예 | [공식 쿠폰 소개](https://new.smartplace.naver.com/introduction/solution-market/coupon) |
| 예약·주문 등 | 쿠폰 발급 대상：모든 고객、혜택알림받기한 고객、마케팅메시지 전송 대상 고객 | 텍스트・선택 | 조건부、대상에 따라 발급 | [공식 쿠폰 소개](https://new.smartplace.naver.com/introduction/solution-market/coupon) |
| 예약·주문 등 | 쿠폰 혜택 | 텍스트·숫자、정확한 세부 필드명 불명 | 예 | [쿠폰 수정](https://help.naver.com/service/30026/contents/20834?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | 쿠폰 노출 기간 | 날짜、정확한 화면 표기 불명 | 조건부 | [쿠폰 생성](https://help.naver.com/service/30026/contents/20833?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | 쿠폰 노출 상태 ON/OFF | 불리언 | 노출 여부에反映 | [노출 중단](https://help.naver.com/service/30026/contents/20836?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | 예약/주문 전용 쿠폰 | 텍스트・선택 | 조건부、예약 전체 또는 주문 전체 대상 | [쿠폰 생성](https://help.naver.com/service/30026/contents/20833?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | 프로모션명、프로모션 기간（주문 프로모션） | 텍스트·날짜 | 명칭은 아니요、내부관리용 | [프로모션](https://help.naver.com/service/30026/contents/20710?lang=ko) |
| 예약·주문 등 | 횟수 및 지급쿠폰、혜택내용(쿠폰명) | 숫자·텍스트 | 조건부、주문 프로모션 | [프로모션](https://help.naver.com/service/30026/contents/20710?lang=ko) |
| 예약·주문 등 | 지급 쿠폰：이미지、안내문구、유효기간 | 이미지·텍스트·숫자(日数) | 조건부、발급 고객 | [프로모션](https://help.naver.com/service/30026/contents/20710?lang=ko) |
| 예약·주문 등 | 사용기준：다른 쿠폰 중복 사용、쿠폰 단독 사용 | 불리언 | 조건부、쿠폰 이용 조건 | [프로모션](https://help.naver.com/service/30026/contents/20710?lang=ko) |
| 예약·주문 등 | 달성기준：스탬프 적용 메뉴、주문 금액 기준 | 텍스트·선택·숫자 | 조건부、주문 프로모션 | [프로모션](https://help.naver.com/service/30026/contents/20710?lang=ko) |
| 예약·주문 등 | 프로모션 안내문구、쿠폰 사용/미사용 처리 | 텍스트·불리언 | 안내문구는 고객向け、처리는 개별 고객 상태 | [프로모션](https://help.naver.com/service/30026/contents/20710?lang=ko) |

**리뷰 운영**

| 영역 | 항목명(공식 표기) | 입력 형식 | 공개 페이지에 노출되는가 | 출처 URL |
|---|---|---|---|---|
| 리뷰 운영 | 영수증 리뷰 답글 등록⋅수정⋅삭제 | 텍스트 | 예 | [답글 도움말](https://help.naver.com/service/30026/contents/20545?lang=ko) |
| 리뷰 운영 | 예약/주문자 리뷰 답글 | 텍스트 | 예 | [답글 작성](https://help.naver.com/service/30026/contents/20717) |
| 리뷰 운영 | 플레이스 평균 별점 ON/OFF | 불리언 | 평균 별점 노출 여부에 반영 | [별점 설정](https://help.naver.com/service/30026/contents/20498?lang=ko&osType=PC) |
| 리뷰 운영 | 방문자 리뷰 키워드 설정 | 텍스트・선택、자유 문구 입력 불가 | 리뷰 작성 화면의 우선 선택지에 반영 | [키워드 설정](https://help.naver.com/service/30026/contents/20504?osType=COMMONOS) |
| 리뷰 운영 | AI 리뷰 답글：스타일、답글 길이 | 텍스트・선택、세부 형식 불명 | 설정 자체는 아니요、등록된 답글만 공개 | [AI 리뷰 관리](https://help.naver.com/service/30026/contents/25102) |
| 리뷰 운영 | AI 답글 초안 재생성、답글 수정·등록 | 텍스트 | 등록 후 예 | [AI 리뷰 관리](https://help.naver.com/service/30026/contents/25102) |
| 리뷰 운영 | 권리침해 리뷰 게시중단 요청 | 텍스트·증빙、요청 절차 | 요청 내용은 일반 공개 아님、심사 결과 반영 | [리뷰 제외 요청](https://help.naver.com/service/30026/contents/20721?osType=COMMONOS) |
| 리뷰 운영 | 방문자 리뷰탭 전체·리뷰 종류별 노출/미노출 | **설정 기능 미제공** | 사업주가 임의 제어 불가 | [미제공 안내](https://help.naver.com/service/19485/contents/12843?osType=MOBILE) |
| 리뷰 운영 | 블로그 리뷰의 개별 글 선정·순위·노출 여부 | **설정 기능 미제공** | 자동 수집·노출 | [블로그 리뷰 기준](https://help.naver.com/service/30026/contents/20489?lang=ko) |
| 리뷰 운영 | 방문자 리뷰 본문·사진·별점 | **사업주 입력 항목 아님** | 이용자가 작성한 내용 노출 | [리뷰탭 설명](https://help.naver.com/service/19485/contents/12843?osType=MOBILE), [별점 설정 범위](https://help.naver.com/service/30026/contents/20498?lang=ko&osType=PC) |

**업종별 추가정보·기타 관리**

| 영역 | 항목명(공식 표기) | 입력 형식 | 공개 페이지에 노출되는가 | 출처 URL |
|---|---|---|---|---|
| 기타 | 스타일명、스타일 카테고리 | 텍스트·선택 | 조건부、미용실·네일샵 | [스타일 정보](https://help.naver.com/service/30026/contents/20436?osType=COMMONOS) |
| 사진 | 스타일 사진 | 이미지 | 조건부、스타일 페이지 | [스타일 정보](https://help.naver.com/service/30026/contents/20436?osType=COMMONOS) |
| 기타 | 스타일이 어울리는 얼굴/헤어 정보 | 텍스트·선택、자유입력 여부 불명 | 조건부 | [스타일 정보](https://help.naver.com/service/30026/contents/20436?osType=COMMONOS) |
| 기타 | 담당 스타일리스트 | 텍스트・선택 | 조건부、네이버 예약 연동 필요 | [스타일 정보](https://help.naver.com/service/30026/contents/20436?osType=COMMONOS) |
| 소개·키워드 | 강점 및 소개（스타일 정보） | 텍스트 | 조건부 | [스타일 정보](https://help.naver.com/service/30026/contents/20436?osType=COMMONOS) |
| 기타 | 객실명、객실 소개、객실 서비스 | 텍스트·선택 | 조건부、숙박 | [객실 정보](https://help.naver.com/service/30026/contents/20439?lang=ko&osType=COMMONOS) |
| 사진 | 객실 사진、가격표 사진、숙소 사진 | 이미지 | 조건부、숙박 | [객실 정보](https://help.naver.com/service/30026/contents/20439?lang=ko&osType=COMMONOS) |
| 기타 | 인원 정보：기준 인원、최대 인원 | 숫자 | 조건부、숙박 | [객실 정보](https://help.naver.com/service/30026/contents/20439?lang=ko&osType=COMMONOS) |
| 메뉴 | 가격 정보：비수기·준성수기·성수기／주중·금요일·토요일 | 숫자 | 조건부、숙박 | [객실 정보](https://help.naver.com/service/30026/contents/20439?lang=ko&osType=COMMONOS) |
| 기타 | 간단하게 입력：숙소명、가격、숙소 설명 | 텍스트·숫자 | 조건부、숙박 | [객실 정보](https://help.naver.com/service/30026/contents/20439?lang=ko&osType=COMMONOS) |
| 기타 | 자체 운영 예약 페이지 링크 | 텍스트・URL | 조건부、모텔 | [객실 정보](https://help.naver.com/service/30026/contents/20439?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | 객실 수、객실유형、입퇴실 시간 | 숫자·선택·날짜/시간 | 조건부、숙박형·데이유즈형 | [숙박 예약](https://help.naver.com/service/30026/contents/20695?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | 객실(사이트)구성：침실、욕실、사이트 유형、면적、바닥 종류 | 숫자·텍스트/선택 | 조건부、숙박 예약 | [숙박 예약](https://help.naver.com/service/30026/contents/20695?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | 적용기간、재고 및 가격、공휴일 및 공휴일 전일 설정 | 날짜·숫자 | 조건부、숙박 예약 | [시즌 가격](https://help.naver.com/service/30026/contents/20681?lang=ko&osType=COMMONOS) |
| 예약·주문 등 | 오늘의 딜 | 숫자・할인율 선택、직접 수치 입력 불가 | 조건부、숙박 당일 예약 | [오늘의 딜](https://help.naver.com/service/30026/contents/20683?lang=ko&osType=COMMONOS) |
| 기타 | 질병명 정보 | 텍스트・선택、최대 10개 | 검색 매칭에 반영、입력 목록 전체 공개 여부 불명 | [질병명 정보](https://help.naver.com/service/30026/contents/22672?lang=ko&osType=COMMONOS) |
| 기타 | 팝업스토어 운영 기간 | 날짜 | 예 | [팝업 정보](https://help.naver.com/service/30026/contents/24316?osType=COMMONOS&ostype=commonos) |
| 기타 | 오픈 예정으로 바로 노출 / 운영 시작일에 맞춰서 노출 | 텍스트・선택 | 검색 노출 시점에 반영 | [팝업 정보](https://help.naver.com/service/30026/contents/24316?osType=COMMONOS&ostype=commonos) |
| 기타 | 팝업스토어 사전 예약 여부 | 불리언 | 예 | [팝업 정보](https://help.naver.com/service/30026/contents/24316?osType=COMMONOS&ostype=commonos) |
| 기타 | 팝업 장소 링크 | 텍스트・장소 선택 | 예 | [팝업 정보](https://help.naver.com/service/30026/contents/24316?osType=COMMONOS&ostype=commonos) |
| 사진 | 팝업 소개 동영상 | 동영상 | 예 | [팝업 정보](https://help.naver.com/service/30026/contents/24316?osType=COMMONOS&ostype=commonos) |
| 소식 | 팝업 이벤트：이벤트명、설정、진행 기간 | 텍스트·날짜、설정 세부 형식 불명 | 예、최대 10개 | [팝업 정보](https://help.naver.com/service/30026/contents/24316?osType=COMMONOS&ostype=commonos) |
| 메뉴 | 팝업 굿즈：상품명、가격、증정 여부、현장 판매 상품 할인율、상품 사진 | 텍스트·숫자·불리언·이미지 | 예、현장 판매 상품 | [팝업 정보](https://help.naver.com/service/30026/contents/24316?osType=COMMONOS&ostype=commonos) |
| 기타 | 사업자등록번호、사업자등록증 | 텍스트·이미지 | 번호는 서비스별 공개 여부 불명、증빙 파일 자체 공개 근거 없음 | [등록](https://help.naver.com/service/30026/contents/20366?osType=COMMONOS) |
| 기타 | 대표자명、통신판매업 신고번호·증 | 텍스트·이미지/파일 | 공개 범위 불명、예약 기본정보·업체서류 항목 확인 | [예약 기본정보](https://help.naver.com/service/30026/contents/20673?osType=COMMONOS) |
| 기타 | 새로 오픈했어요 신청、개업일 증빙 | 불리언·날짜·이미지 | 조건 충족·검수 후 예 | [노출 기준](https://help.naver.com/service/30026/contents/20511) |
| 기타 | 업체정보 관리 알림 토픽 | 불리언 | 아니요 | [업체정보 알림](https://help.naver.com/service/30026/contents/25180?osType=COMMONOS) |
| 기타 | 네이버웍스 사용하기、직원 초대 전화번호、직원 삭제·되돌리기 | 불리언·텍스트 | 아니요、스마트플레이스 앱 직원관리 | [직원관리](https://help.naver.com/service/5626/contents/20502?lang=ko&osType=MOBILE) |

**2026년 최신성·변경·폐지 확인**

| 대상 | 확인 결과 | 기준일·변경일 | 출처 |
|---|---|---|---|
| 대표키워드 개수 | 현행 등록·수정 도움말은 **최대 5개**. 개수가 늘거나 줄었다는 공식 변경 근거는 이번 조사에서 미확인 | 개정일 불명 | [수정 도움말](https://help.naver.com/service/30026/contents/20379?lang=ko&osType=PC) |
| 대표키워드와 리뷰 키워드 | 서로 다른 설정. 리뷰 키워드는 정해진 선택지 중 선택하며 자유 문구 입력 불가 | 현행 도움말、개정일 불명 | [리뷰 키워드](https://help.naver.com/service/30026/contents/20504?osType=COMMONOS) |
| 스마트콜 종료 여부 | **종료로 분류할 근거 없음.** 2026년 스팸필터 신설 확인 | 2026-05-26 공지 | [신설 공지](https://m.smartplace.naver.com/notices/1021) |
| 반려동물 동반·노키즈존 | 기존 옵션에 운영 여부·상세설명 입력 추가 | 2026-06-05 공지、7월 노출 공지 | [입력 개편](https://smartplace.naver.com/notices/1032), [노출](https://new.smartplace.naver.com/notices/1063) |
| 인근 주차장 소개 | 입력 항목 추가、등록 정보의 홈·정보 탭 노출 안내 | 2026-06~07 | [개편](https://smartplace.naver.com/notices/1032), [노출](https://new.smartplace.naver.com/notices/1063) |
| 콜키지 | 기존 유료/무료 옵션에서 가능 여부·일부 무료 조건 등 상세 설정으로 보강 | 2026-06-05 | [개편](https://smartplace.naver.com/notices/1032) |
| 생일혜택·전문 소믈리에 | **생일/기념일 혜택**, **소믈리에**로 보강·명칭 변경 | 2026년 공지·도움말 | [도움말](https://help.naver.com/service/30026/contents/25094?lang=ko&osType=COMMONOS), [공지](https://new.smartplace.naver.com/notices/1063) |
| 공휴일 선택지 | 스마트플레이스 공지는 노동절·제헌절의 휴무 설정 항목 추가 안내 | 2026-04-23 | [설정 공지](https://smartplace.naver.com/notices/990) |
| 업체사진의 움직이는 GIF | 정지 이미지로 전환 노출、움직이는 GIF 업로드 제한 안내 | 2025-10-30 적용 안내 | [이미지 정책](https://new.smartplace.naver.com/notices/922) |
| 예약·주문 움직이는 GIF/PNG | 신규 업로드 제한、기등록 이미지는 정지 이미지 전환 안내 | 2026-02-26 적용 안내 | [이미지 정책](https://m.smartplace.naver.com/notices/968) |
| 새소식 공지 기간 | 공지 노출 **최대 45일**. 소식 자체의 행사 기간과 구별 | 2024-12-05 이후、현행 도움말 재확인 | [변경 공지](https://new.smartplace.naver.com/notices/822), [현행 도움말](https://help.naver.com/service/30026/contents/20513?lang=ko&osType=COMMONOS) |
| 새소식 작성 기기 | 과거 ‘모바일만’ 안내는 현재 기준으로 사용하면 안 됨. 현행 도움말은 PC·모바일 모두 지원 | 최초 공지 대비 변경、정확한 전환일 불명 | [2018 공지](https://new.smartplace.naver.com/notices/49), [현행 도움말](https://help.naver.com/service/30026/contents/20513?lang=ko&osType=COMMONOS) |
| 식당 일반형 예약 화면 | 화면 개편이지만 입력한 예약 정보·선택 항목·조건은 변경되지 않는다고 명시 | 2026-07-24 | [개편 공지](https://smartplace.naver.com/notices/1074) |
| 사진 탭 태그 | 방문자 리뷰·블로그 사진을 AI가 분류. 사업주가 태그·사진 순서를 직접 지정하는 영역 아님 | 현행 도움말、개정일 불명 | [AI 분류](https://help.naver.com/service/30026/contents/25439?lang=ko&osType=COMMONOS) |
| 방문자 리뷰탭 숨김 | 전체·리뷰 종류별 노출 설정을 제공하지 않는다고 명시. 평균 별점 ON/OFF와 구별 | 현행 도움말、폐지 시점 불명 | [리뷰탭](https://help.naver.com/service/19485/contents/12843?osType=MOBILE), [평균 별점](https://help.naver.com/service/30026/contents/20498?lang=ko&osType=PC) |

**직접 입력 목록에 섞으면 안 되는 정보**

블로그 리뷰는 자동 수집 대상이며, **사장님 블로그를 소식에 연결하는 기능**과 다릅니다. 병의원의 진료과목·전문의·특수진료장비·우수기관 평가정보는 도움말상 건강보험심사평가원 제공 정보입니다. 동물병원 플레이스 플러스의 방문·진료 통계도 실제 연동 데이터를 기반으로 하므로 사장님이 통계 수치를 직접 작성하는 항목으로 분류하지 않았습니다. [블로그 리뷰](https://help.naver.com/service/30026/contents/20489?lang=ko), [병의원 정보](https://help.naver.com/service/30026/contents/20379?lang=ko&osType=PC), [동물병원 플러스](https://smartplace.naver.com/notices/1037)

또한 위 표의 일반 쿠폰과 별개인 **멤버십쿠폰**은 확인된 도움말에서 도도포인트·페이히어·오케이포스 등 제휴 서비스에서 생성·관리하고 스마트플레이스에서는 현황을 확인하는 방식으로 안내됩니다. 스마트플레이스 자체 입력 필드로 일괄 포함할 수 없습니다. [멤버십 도움말 목록](https://help.naver.com/service/30026/category/7359?lang=ko)

**마지막: 요청하신 ‘24개 항목’의 검증**

제시된 목록은 **쉼표로 구분하면 23개 묶음**입니다. 아래는 특히 구분·수정이 필요한 항목입니다.

| 요청 항목 | 공식 도움말 기준 판정 | 근거 |
|---|---|---|
| 상호 | **확인**. 관리 항목의 공식 표기는 주로 **업체명** | [업체 수정](https://help.naver.com/service/30026/contents/20379?lang=ko&osType=PC) |
| 소개문 | **확인**. 공식 표기는 **상세 설명/상세설명** | [업체 수정](https://help.naver.com/service/30026/contents/20379?lang=ko&osType=PC) |
| 대표키워드 5개 | **확인**. 정확히는 필수 5개가 아니라 **최대 5개** | [업체 수정](https://help.naver.com/service/30026/contents/20379?lang=ko&osType=PC) |
| 브레이크타임·휴무일 | **확인**. 도움말은 **휴게 시간**과 각종 휴무일로 설명 | [영업시간](https://help.naver.com/service/30026/contents/20380?osType=MOBILE) |
| 메뉴 사진 | **부분 확인**. 도움말의 **메뉴판 사진**은 명확함. 개별 음식 사진의 독립 필드명·일반 플레이스 입력 구조는 불명. 예약·주문의 **메뉴 이미지**는 공식 공지로 확인 | [도움말](https://help.naver.com/service/30026/contents/20379?lang=ko&osType=PC), [예약·주문 공지](https://m.smartplace.naver.com/notices/968) |
| 인테리어·외관 사진 구분 | **사장님이 직접 지정하는 독립 입력·분류 항목으로는 미확인／불명**. 공개 사진 탭의 AI 분류를 그 근거로 사용할 수 없음 | [AI 분류 도움말](https://help.naver.com/service/30026/contents/25439?lang=ko&osType=COMMONOS) |
| 쿠폰·이벤트 | **쿠폰 확인**. 이벤트는 새소식 콘텐츠로 공식 공지에서 확인되고, 팝업스토어는 별도 **이벤트 정보** 도움말도 존재. 모든 업종 공통의 독립 ‘이벤트’ 필드는 불명 | [쿠폰](https://help.naver.com/service/30026/contents/20833?lang=ko&osType=COMMONOS), [새소식 공지](https://smartplace.naver.com/notices/695), [팝업 도움말](https://help.naver.com/service/30026/contents/24316?osType=COMMONOS&ostype=commonos) |
| 방문자 리뷰 | **기능 존재 확인、사장님 직접 입력 항목은 아님** | [리뷰탭 안내](https://help.naver.com/service/19485/contents/12843?osType=MOBILE) |
| 사장님 답글 | **확인**. 영수증 리뷰·예약/주문 리뷰 답글 기능 | [영수증 답글](https://help.naver.com/service/30026/contents/20545?lang=ko), [예약·주문 답글](https://help.naver.com/service/30026/contents/20717) |
| 블로그 리뷰 | **기능 존재 확인、직접 입력·선정·정렬 항목은 아님** | [자동 수집 기준](https://help.naver.com/service/30026/contents/20489?lang=ko) |
| 정책 위반 문구（리뷰 인센티브 금지 규정） | **입력 항목으로 미확인. ‘리뷰 인센티브 전면 금지’라는 포괄 규정도 이번에 확인한 도움말로 뒷받침되지 않음** | [어뷰징 도움말](https://help.naver.com/service/19485/contents/24961?osType=MOBILE) |

나머지 **업종、전화、영업시간、찾아오는 길、메뉴(가격)、사진、소식、홈페이지·SNS 링크、네이버 예약、톡톡、스마트콜、편의시설·주차**는 위 표의 공식 도움말에서 존재가 확인됩니다.

리뷰 정책에서 확인되는 금지 대상은 **미방문·미경험 허위 리뷰, 가짜 영수증·허위 예약, 특정 점수나 긍정적 내용을 강요·통제하는 행위** 등입니다. 단순 리뷰 작성 안내·참여 요청 자체는 해당 강요 행위에 포함하지 않는다고 명시되어 있습니다. 따라서 이를 **‘어떤 리뷰 혜택도 전부 금지’로 확대해 적는 것은 근거 부족**입니다. [네이버 공식 어뷰징 도움말](https://help.naver.com/service/19485/contents/24961?osType=MOBILE)